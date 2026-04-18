import { Response } from 'express';
import prisma from '../prismaClient';
import { AuthRequest } from '../middleware/auth';
import { getIO } from '../services/socketService';
import { sendExpoPushNotification } from '../utils/push';

/** POST /api/messages/send — REST fallback for sending a message (when socket unavailable) */
export async function sendMessage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const { receiverId, groupId, content, messageType = 'text', localMessageId, metadata } = req.body;
    const normalizedMessageType = messageType === 'card' ? 'text' : messageType;
    const normalizedMetadata = messageType === 'card'
      ? { ...(metadata || {}), isCard: true }
      : (metadata || undefined);

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
          message_type: normalizedMessageType,
          local_message_id: localMessageId || null,
          metadata: normalizedMetadata,
        },
        include: { sender: { select: { id: true, name: true, phone: true, profile_picture: true } } },
      });

      await prisma.group.update({
        where: { id: groupId },
        data: { last_message_id: message.id, last_message_time: message.created_at },
      });

      // Emit real-time notification to all other group members via their personal socket room
      try {
        const io = getIO();
        if (io) {
          const members = await prisma.groupMember.findMany({
            where: { group_id: groupId, user_id: { not: userId } },
            select: { user_id: true },
          });
          const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: { name: true },
          });
          const payload = {
            groupId,
            groupName: group?.name ?? 'Group',
            senderId: userId,
            senderName: message.sender?.name ?? 'Someone',
            content: message.content,
            messageType: message.message_type,
            createdAt: message.created_at,
          };
          for (const m of members) {
            io.to(`user:${m.user_id}`).emit('group:notification', payload);
          }

          // FCM push for group message
          const membersWithTokens = await prisma.groupMember.findMany({
            where: { group_id: groupId, user_id: { not: userId } },
            include: { user: { select: { id: true, push_token: true } } },
          });
          const isCard = message.message_type === 'card' || (() => { try { const p = JSON.parse(content); return !!(p?.full_name || p?.company_name); } catch { return false; } })();
          const body = isCard ? 'Sent a business card' : content.length > 60 ? content.slice(0, 60) + '...' : content;
          for (const m of membersWithTokens) {
            if (m.user?.push_token) {
              sendExpoPushNotification(m.user.push_token, group?.name ?? 'Group', `${message.sender?.name ?? 'Someone'}: ${body}`, { screen: 'GroupChat', groupId, groupName: group?.name });
            }
          }
        }
      } catch { /* non-blocking */ }

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
        message_type: normalizedMessageType,
        local_message_id: localMessageId || null,
        metadata: normalizedMetadata,
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

    // FCM push for DM message when app is closed
    try {
      const recipient = await prisma.user.findUnique({ where: { id: receiverId }, select: { push_token: true } });
      if (recipient?.push_token) {
        const dmBody = content.length > 60 ? content.slice(0, 60) + '...' : content;
        sendExpoPushNotification(recipient.push_token, message.sender?.name ?? 'New Message', dmBody, { screen: 'Chat', chatId: chat.id });
      }
    } catch { /* non-blocking */ }

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
    const messageId = parseInt(req.params.messageId as string);

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
  const derivedMessageType = msg?.metadata?.isCard ? 'card' : msg.message_type;
  return {
    id: msg.id,
    senderId: msg.sender_id,
    receiverId: msg.receiver_id,
    chatId: msg.chat_id,
    groupId: msg.group_id,
    content: msg.content,
    messageType: derivedMessageType,
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
