import { Response } from 'express';
import prisma from '../prismaClient';
import { AuthRequest } from '../middleware/auth';

/** GET /api/chats — list user's conversations */
export async function getConversations(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;

    const participants = await prisma.chatParticipant.findMany({
      where: { user_id: userId },
      include: {
        chat: {
          include: {
            participants: {
              where: { user_id: { not: userId } },
              include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
            },
            last_message: {
              include: { sender: { select: { id: true, name: true } } },
            },
            group: { select: { id: true, name: true, icon: true } },
          },
        },
      },
      orderBy: { chat: { last_message_time: 'desc' } },
    });

    const chats = participants.map((p) => {
      const chat = p.chat;
      const other = chat.participants[0]?.user;
      return {
        id: chat.id,
        isGroup: chat.is_group,
        groupId: chat.group?.id || null,
        groupName: chat.group?.name || null,
        groupIcon: chat.group?.icon || null,
        otherUser: chat.is_group ? null : other ? { id: other.id, name: other.name, phone: other.phone, avatar: other.profile_picture } : null,
        lastMessage: chat.last_message
          ? {
              id: chat.last_message.id,
              content: chat.last_message.content,
              messageType: chat.last_message.message_type,
              senderId: chat.last_message.sender_id,
              senderName: chat.last_message.sender?.name,
              createdAt: chat.last_message.created_at,
            }
          : null,
        unreadCount: p.unread_count,
        isMuted: p.is_muted,
        lastMessageTime: chat.last_message_time,
      };
    });

    res.json(chats);
  } catch (err: any) {
    console.error('getConversations error:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
}

/** GET /api/chats/:chatId/messages — paginated message history */
export async function getChatMessages(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const chatId = parseInt(req.params.chatId);
    const cursor = req.query.cursor ? parseInt(String(req.query.cursor)) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 100);

    // Verify user is a participant
    const participant = await prisma.chatParticipant.findUnique({
      where: { chat_id_user_id: { chat_id: chatId, user_id: userId } },
    });
    if (!participant) return res.status(403).json({ error: 'Not a participant in this chat' });

    const messages = await prisma.message.findMany({
      where: { chat_id: chatId, is_deleted: false },
      include: { sender: { select: { id: true, name: true, phone: true, profile_picture: true } } },
      orderBy: { created_at: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const formatted = messages.reverse().map((msg) => ({
      id: msg.id,
      senderId: msg.sender_id,
      receiverId: msg.receiver_id,
      chatId: msg.chat_id,
      content: msg.content,
      messageType: msg.message_type,
      isRead: msg.is_read,
      readAt: msg.read_at,
      isDelivered: msg.is_delivered,
      deliveredAt: msg.delivered_at,
      localMessageId: msg.local_message_id,
      metadata: msg.metadata,
      createdAt: msg.created_at,
      sender: { id: msg.sender.id, name: msg.sender.name, phone: msg.sender.phone, avatar: msg.sender.profile_picture },
    }));

    const nextCursor = messages.length === limit ? messages[0].id : null;

    res.json({ messages: formatted, nextCursor });
  } catch (err: any) {
    console.error('getChatMessages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

/** POST /api/chats/find-or-create — find or create a 1-on-1 chat */
export async function findOrCreateChat(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const { otherUserId } = req.body;
    if (!otherUserId) return res.status(400).json({ error: 'otherUserId required' });

    // Find existing
    const existing = await prisma.chat.findFirst({
      where: {
        is_group: false,
        AND: [
          { participants: { some: { user_id: userId } } },
          { participants: { some: { user_id: otherUserId } } },
        ],
      },
      include: {
        participants: {
          where: { user_id: { not: userId } },
          include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
        },
      },
    });

    if (existing) {
      const other = existing.participants[0]?.user;
      return res.json({
        id: existing.id,
        isGroup: false,
        otherUser: other ? { id: other.id, name: other.name, phone: other.phone, avatar: other.profile_picture } : null,
      });
    }

    const chat = await prisma.chat.create({
      data: {
        is_group: false,
        participants: {
          create: [{ user_id: userId }, { user_id: otherUserId }],
        },
      },
      include: {
        participants: {
          where: { user_id: { not: userId } },
          include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
        },
      },
    });

    const other = chat.participants[0]?.user;
    res.status(201).json({
      id: chat.id,
      isGroup: false,
      otherUser: other ? { id: other.id, name: other.name, phone: other.phone, avatar: other.profile_picture } : null,
    });
  } catch (err: any) {
    console.error('findOrCreateChat error:', err);
    res.status(500).json({ error: 'Failed to create chat' });
  }
}

/** PUT /api/chats/:chatId/mute — toggle mute */
export async function toggleMute(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const chatId = parseInt(req.params.chatId);
    const { muted } = req.body;

    await prisma.chatParticipant.update({
      where: { chat_id_user_id: { chat_id: chatId, user_id: userId } },
      data: { is_muted: !!muted },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update mute' });
  }
}
