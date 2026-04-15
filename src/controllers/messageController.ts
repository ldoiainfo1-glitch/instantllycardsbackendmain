import { Response } from 'express';
import prisma from '../prismaClient';
import { AuthRequest } from '../middleware/auth';

/** POST /api/messages/send — REST fallback for sending a message (when socket unavailable) */
export async function sendMessage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const { receiverId, groupId, content, messageType = 'text', localMessageId, metadata } = req.body;

    if (!content) return res.status(400).json({ error: 'content required' });
    if (!receiverId && !groupId) return res.status(400).json({ error: 'receiverId or groupId required' });

    if (groupId) {
      // Group message
      const membership = await prisma.groupMember.findUnique({
        where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      });
      if (!membership) return res.status(403).json({ error: 'Not a member of this group' });

      const message = await prisma.message.create({
        data: {
          sender_id: userId,
          group_id: groupId,
          content,
          message_type: messageType,
          local_message_id: localMessageId || null,
          metadata: metadata || undefined,
        },
        include: { sender: { select: { id: true, name: true, phone: true, profile_picture: true } } },
      });

      await prisma.group.update({
        where: { id: groupId },
        data: { last_message_id: message.id, last_message_time: message.created_at },
      });

      return res.status(201).json(formatMsg(message));
    }

    // Private message
    let chat = await prisma.chat.findFirst({
      where: {
        is_group: false,
        AND: [
          { participants: { some: { user_id: userId } } },
          { participants: { some: { user_id: receiverId } } },
        ],
      },
    });

    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          is_group: false,
          participants: { create: [{ user_id: userId }, { user_id: receiverId }] },
        },
      });
    }

    const message = await prisma.message.create({
      data: {
        sender_id: userId,
        receiver_id: receiverId,
        chat_id: chat.id,
        content,
        message_type: messageType,
        local_message_id: localMessageId || null,
        metadata: metadata || undefined,
        is_pending_delivery: true,
      },
      include: { sender: { select: { id: true, name: true, phone: true, profile_picture: true } } },
    });

    await prisma.chat.update({
      where: { id: chat.id },
      data: { last_message_id: message.id, last_message_time: message.created_at },
    });

    await prisma.chatParticipant.updateMany({
      where: { chat_id: chat.id, user_id: receiverId },
      data: { unread_count: { increment: 1 } },
    });

    res.status(201).json(formatMsg(message));
  } catch (err: any) {
    console.error('sendMessage error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

/** DELETE /api/messages/:messageId — soft delete a message */
export async function deleteMessage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const messageId = parseInt(req.params.messageId);

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.sender_id !== userId) return res.status(403).json({ error: 'Can only delete own messages' });

    await prisma.message.update({
      where: { id: messageId },
      data: { is_deleted: true, deleted_at: new Date() },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete message' });
  }
}

function formatMsg(msg: any) {
  return {
    id: msg.id,
    senderId: msg.sender_id,
    receiverId: msg.receiver_id,
    chatId: msg.chat_id,
    groupId: msg.group_id,
    content: msg.content,
    messageType: msg.message_type,
    isRead: msg.is_read,
    isDelivered: msg.is_delivered,
    localMessageId: msg.local_message_id,
    metadata: msg.metadata,
    createdAt: msg.created_at,
    sender: msg.sender
      ? { id: msg.sender.id, name: msg.sender.name, phone: msg.sender.phone, avatar: msg.sender.profile_picture }
      : undefined,
  };
}
