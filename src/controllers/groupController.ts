import { Response } from 'express';
import crypto from 'crypto';
import prisma from '../prismaClient';
import { AuthRequest } from '../middleware/auth';

/** GET /api/groups — list user's groups */
export async function getGroups(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;

    const memberships = await prisma.groupMember.findMany({
      where: { user_id: userId },
      include: {
        group: {
          include: {
            admin: { select: { id: true, name: true } },
            last_message: {
              include: { sender: { select: { id: true, name: true } } },
            },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { group: { last_message_time: 'desc' } },
    });

    const groups = memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      description: m.group.description,
      icon: m.group.icon,
      joinCode: m.group.join_code,
      adminId: m.group.admin_id,
      adminName: m.group.admin?.name,
      memberCount: m.group._count.members,
      myRole: m.role,
      isMuted: m.is_muted,
      lastMessage: m.group.last_message
        ? {
            id: m.group.last_message.id,
            content: m.group.last_message.content,
            senderId: m.group.last_message.sender_id,
            senderName: m.group.last_message.sender?.name,
            createdAt: m.group.last_message.created_at,
          }
        : null,
      lastMessageTime: m.group.last_message_time,
      createdAt: m.group.created_at,
    }));

    res.json(groups);
  } catch (err: any) {
    console.error('getGroups error:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
}

/** POST /api/groups — create a group */
export async function createGroup(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const { name, description, icon, memberIds = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const joinCode = crypto.randomBytes(3).toString('hex').toUpperCase();

    const group = await prisma.group.create({
      data: {
        name,
        description: description || null,
        icon: icon || null,
        admin_id: userId,
        join_code: joinCode,
        members: {
          create: [
            { user_id: userId, role: 'admin' },
            ...memberIds
              .filter((id: number) => id !== userId)
              .map((id: number) => ({ user_id: id, role: 'member' })),
          ],
        },
      },
      include: { _count: { select: { members: true } } },
    });

    res.status(201).json({
      id: group.id,
      name: group.name,
      description: group.description,
      icon: group.icon,
      joinCode: group.join_code,
      adminId: group.admin_id,
      memberCount: group._count.members,
      myRole: 'admin',
      createdAt: group.created_at,
    });
  } catch (err: any) {
    console.error('createGroup error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
}

/** POST /api/groups/join — join via invite code */
export async function joinGroup(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const { joinCode } = req.body;
    if (!joinCode) return res.status(400).json({ error: 'joinCode required' });

    const group = await prisma.group.findUnique({
      where: { join_code: joinCode.toUpperCase() },
    });
    if (!group || !group.is_active) return res.status(404).json({ error: 'Group not found' });

    // Check if already a member
    const existing = await prisma.groupMember.findUnique({
      where: { group_id_user_id: { group_id: group.id, user_id: userId } },
    });
    if (existing) return res.json({ id: group.id, name: group.name, alreadyMember: true });

    await prisma.groupMember.create({
      data: { group_id: group.id, user_id: userId, role: 'member' },
    });

    res.json({ id: group.id, name: group.name, alreadyMember: false });
  } catch (err: any) {
    console.error('joinGroup error:', err);
    res.status(500).json({ error: 'Failed to join group' });
  }
}

/** GET /api/groups/:groupId — group details with members */
export async function getGroupDetail(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const groupId = parseInt(req.params.groupId);

    const membership = await prisma.groupMember.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        admin: { select: { id: true, name: true, phone: true, profile_picture: true } },
        members: {
          include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    res.json({
      id: group.id,
      name: group.name,
      description: group.description,
      icon: group.icon,
      joinCode: group.join_code,
      admin: { id: group.admin.id, name: group.admin.name, phone: group.admin.phone, avatar: group.admin.profile_picture },
      members: group.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        phone: m.user.phone,
        avatar: m.user.profile_picture,
        role: m.role,
        joinedAt: m.created_at,
      })),
      myRole: membership.role,
      createdAt: group.created_at,
    });
  } catch (err: any) {
    console.error('getGroupDetail error:', err);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
}

/** GET /api/groups/:groupId/messages — paginated group messages */
export async function getGroupMessages(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const groupId = parseInt(req.params.groupId);
    const cursor = req.query.cursor ? parseInt(String(req.query.cursor)) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 100);

    const membership = await prisma.groupMember.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const messages = await prisma.message.findMany({
      where: { group_id: groupId, is_deleted: false },
      include: { sender: { select: { id: true, name: true, phone: true, profile_picture: true } } },
      orderBy: { created_at: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const formatted = messages.reverse().map((msg) => ({
      id: msg.id,
      senderId: msg.sender_id,
      groupId: msg.group_id,
      content: msg.content,
      messageType: msg.message_type,
      isRead: msg.is_read,
      localMessageId: msg.local_message_id,
      metadata: msg.metadata,
      createdAt: msg.created_at,
      sender: { id: msg.sender.id, name: msg.sender.name, phone: msg.sender.phone, avatar: msg.sender.profile_picture },
    }));

    const nextCursor = messages.length === limit ? messages[0].id : null;
    res.json({ messages: formatted, nextCursor });
  } catch (err: any) {
    console.error('getGroupMessages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

/** PUT /api/groups/:groupId — update group (admin only) */
export async function updateGroup(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const groupId = parseInt(req.params.groupId);

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin_id !== userId) return res.status(403).json({ error: 'Only admin can update group' });

    const { name, description, icon } = req.body;
    const updated = await prisma.group.update({
      where: { id: groupId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
      },
    });

    res.json({ id: updated.id, name: updated.name, description: updated.description, icon: updated.icon });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update group' });
  }
}

/** DELETE /api/groups/:groupId/members/:memberId — remove member (admin) or leave (self) */
export async function removeMember(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const groupId = parseInt(req.params.groupId);
    const memberId = parseInt(req.params.memberId);

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Allow self-leave or admin-remove
    if (memberId !== userId && group.admin_id !== userId) {
      return res.status(403).json({ error: 'Only admin can remove members' });
    }

    await prisma.groupMember.delete({
      where: { group_id_user_id: { group_id: groupId, user_id: memberId } },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
}

/** POST /api/groups/:groupId/members — add members (admin only) */
export async function addMembers(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const groupId = parseInt(req.params.groupId);
    const { memberIds } = req.body;

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin_id !== userId) return res.status(403).json({ error: 'Only admin can add members' });

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: 'memberIds array required' });
    }

    // Filter out existing members
    const existingMembers = await prisma.groupMember.findMany({
      where: { group_id: groupId, user_id: { in: memberIds } },
      select: { user_id: true },
    });
    const existingIds = new Set(existingMembers.map((m) => m.user_id));
    const newIds = memberIds.filter((id: number) => !existingIds.has(id));

    if (newIds.length > 0) {
      await prisma.groupMember.createMany({
        data: newIds.map((id: number) => ({ group_id: groupId, user_id: id, role: 'member' })),
      });
    }

    res.json({ added: newIds.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to add members' });
  }
}
