import { Router, Request, Response } from 'express';
import { requireAdminKey } from '../middleware/auth';
import prisma from '../utils/prisma';

const router = Router();

// GET /api/feedback/all  — admin only
router.get('/all', requireAdminKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Number(req.query.limit || 20));
    const status = req.query.status as string | undefined;
    const where: any = {};
    if (status) where.status = status;
    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { created_at: 'desc' }, include: { user: { select: { id: true, name: true, phone: true } } } }),
      prisma.feedback.count({ where }),
    ]);
    res.json({ success: true, feedbacks, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) { console.error('[feedback/all]', err); res.status(500).json({ error: 'Failed to fetch feedback' }); }
});

// PUT /api/feedback/:id/status  — admin only
router.put('/:id/status', requireAdminKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { status, admin_response } = req.body;
    const feedback = await prisma.feedback.update({
      where: { id },
      data: { status, admin_response, responded_at: admin_response ? new Date() : undefined },
    });
    res.json({ success: true, feedback });
  } catch (err) { console.error('[feedback/status]', err); res.status(500).json({ error: 'Failed to update feedback' }); }
});

export default router;
