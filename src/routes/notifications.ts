import { Router, Response, RequestHandler } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../prismaClient';
import { paramInt } from '../utils/params';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

// GET /api/notifications — fetch notifications for current user
router.get('/', authenticate, h(async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const notifications = await prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    const unreadCount = notifications.filter((n) => !n.is_read).length;
    res.json({
      notifications: notifications.map((n) => ({
        id: String(n.id),
        user_id: String(n.user_id),
        type: n.type ?? 'general',
        title: n.title,
        description: n.description ?? null,
        emoji: '🔔',
        read: n.is_read,
        created_at: n.created_at.toISOString(),
      })),
      unreadCount,
    });
  } catch (err) {
    console.error('[notifications/get]', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
}));

// PATCH /api/notifications/:id/read — mark one as read
router.patch('/:id/read', authenticate, h(async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const id = paramInt(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    await prisma.notification.updateMany({
      where: { id, user_id: userId },
      data: { is_read: true },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications/read]', err);
    res.status(500).json({ error: 'Failed to mark read' });
  }
}));

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', authenticate, h(async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    await prisma.notification.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications/read-all]', err);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
}));

// DELETE /api/notifications — delete all for current user
router.delete('/', authenticate, h(async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    await prisma.notification.deleteMany({ where: { user_id: userId } });
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications/delete-all]', err);
    res.status(500).json({ error: 'Failed to delete notifications' });
  }
}));

export default router;
