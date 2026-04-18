import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from '../prismaClient';
import { sendExpoPushNotification } from '../utils/push';

interface AuthSocket extends Socket {
  userId?: number;
}

let _io: Server | null = null;

export function getIO(): Server | null {
  return _io;
}

export function initSocketService(io: Server) {
  _io = io;
  // Auth middleware
  io.use((socket: AuthSocket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { userId: number };
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    const userId = socket.userId!;
    console.log(`[Socket] User ${userId} connected (${socket.id})`);

    // Join personal room for targeted events
    socket.join(`user:${userId}`);

    // Join a chat room
    socket.on('chat:join', (chatId: number) => {
      socket.join(`chat:${chatId}`);
    });

    // Leave a chat room
    socket.on('chat:leave', (chatId: number) => {
      socket.leave(`chat:${chatId}`);
    });

    // Send a message via socket
    socket.on('message:send', async (data: {
      chatId?: number;
      receiverId?: number;
      groupId?: number;
      content: string;
      messageType?: string;
      localMessageId?: string;
    }) => {
      try {
        const { chatId, receiverId, groupId, content, messageType = 'text', localMessageId } = data;

        if (!content) return socket.emit('message:error', { error: 'content required' });

        const msgType = messageType as import('@prisma/client').MessageType;

        let message: any;

        if (groupId) {
          const membership = await prisma.groupMember.findUnique({
            where: { group_id_user_id: { group_id: groupId, user_id: userId } },
          });
          if (!membership) return socket.emit('message:error', { error: 'Not a group member' });

          message = await prisma.message.create({
            data: { sender_id: userId, group_id: groupId, content, message_type: msgType, local_message_id: localMessageId || null },
            include: { sender: { select: { id: true, name: true, phone: true, profile_picture: true } } },
          });

          await prisma.group.update({
            where: { id: groupId },
            data: { last_message_id: message.id, last_message_time: message.created_at },
          });

          io.to(`chat:${message.chat_id}`).emit('message:new', formatMsg(message));

          // Notify the other group members' personal rooms + FCM
          const groupMembers = await prisma.groupMember.findMany({
            where: { group_id: groupId, user_id: { not: userId } },
            include: { user: { select: { id: true, push_token: true } } },
          });
          const grp = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
          for (const m of groupMembers) {
            io.to(`user:${m.user_id}`).emit('group:notification', {
              groupId,
              groupName: grp?.name ?? 'Group',
              senderId: userId,
              senderName: message.sender?.name ?? 'Someone',
              content: message.content,
              messageType: message.message_type,
              createdAt: message.created_at,
            });
            if (m.user?.push_token) {
              const isCard = message.message_type === 'card' || (() => { try { const p = JSON.parse(content); return !!(p?.full_name || p?.company_name); } catch { return false; } })();
              const body = isCard ? 'Sent a business card' : content.length > 60 ? content.slice(0, 60) + '...' : content;
              sendExpoPushNotification(m.user.push_token, grp?.name ?? 'Group', `${message.sender?.name ?? 'Someone'}: ${body}`, { screen: 'GroupChat', groupId, groupName: grp?.name });
            }
          }
        } else {
          let chat = chatId ? await prisma.chat.findUnique({ where: { id: chatId } }) : null;

          if (!chat && receiverId) {
            chat = await prisma.chat.findFirst({
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
                data: { is_group: false, participants: { create: [{ user_id: userId }, { user_id: receiverId }] } },
              });
            }
          }

          if (!chat) return socket.emit('message:error', { error: 'Chat not found' });

          message = await prisma.message.create({
            data: { sender_id: userId, chat_id: chat.id, content, message_type: msgType, local_message_id: localMessageId || null },
            include: { sender: { select: { id: true, name: true, phone: true, profile_picture: true } } },
          });

          await prisma.chat.update({
            where: { id: chat.id },
            data: { last_message_id: message.id, last_message_time: message.created_at },
          });

          // Increment unread for other participants
          await prisma.chatParticipant.updateMany({
            where: { chat_id: chat.id, user_id: { not: userId } },
            data: { unread_count: { increment: 1 } },
          });

          io.to(`chat:${chat.id}`).emit('message:new', formatMsg(message));

          // Notify the other user's personal room if not in chat room
          if (receiverId) {
            io.to(`user:${receiverId}`).emit('chat:notification', {
              chatId: chat.id,
              message: formatMsg(message),
            });
            // FCM push for DM when app is closed
            try {
              const recipient = await prisma.user.findUnique({ where: { id: receiverId }, select: { push_token: true } });
              if (recipient?.push_token) {
                sendExpoPushNotification(recipient.push_token, message.sender?.name ?? 'New Message', content.length > 60 ? content.slice(0, 60) + '...' : content, { screen: 'Chat', chatId: chat.id });
              }
            } catch { /* non-blocking */ }
          }
        }

        socket.emit('message:sent', { localMessageId, messageId: message.id });
      } catch (err: any) {
        console.error('[Socket] message:send error:', err);
        socket.emit('message:error', { error: 'Failed to send message' });
      }
    });

    // Mark messages as read
    socket.on('chat:read', async (chatId: number) => {
      try {
        await prisma.chatParticipant.updateMany({
          where: { chat_id: chatId, user_id: userId },
          data: { unread_count: 0 },
        });
        socket.to(`chat:${chatId}`).emit('chat:read', { chatId, userId });
      } catch (err) {
        console.error('[Socket] chat:read error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] User ${userId} disconnected`);
    });
  });
}

function formatMsg(msg: any) {
  return {
    id: msg.id,
    chatId: msg.chat_id,
    groupId: msg.group_id,
    senderId: msg.sender_id,
    sender: msg.sender,
    content: msg.content,
    messageType: msg.message_type,
    localMessageId: msg.local_message_id,
    isDeleted: msg.is_deleted,
    createdAt: msg.created_at,
    updatedAt: msg.updated_at,
  };
}
