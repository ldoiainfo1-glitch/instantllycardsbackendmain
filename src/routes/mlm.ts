import { Router, Request, Response } from 'express';
import { requireAdminKey } from '../middleware/auth';
import prisma from '../utils/prisma';

const router = Router();

// GET /api/mlm/admin/credits/pending-approval
router.get('/admin/credits/pending-approval', requireAdminKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const credits = await prisma.mlmCredit.findMany({
      where: { payment_status: 'pending', status: { not: 'rejected' } },
      orderBy: { created_at: 'desc' },
      include: {
        sender: { select: { id: true, name: true, phone: true } },
        receiver: { select: { id: true, name: true, phone: true } },
      },
    });
    res.json({ success: true, credits });
  } catch (err) { console.error('[mlm/credits/pending]', err); res.status(500).json({ error: 'Failed to fetch pending credits' }); }
});

// PUT /api/mlm/admin/credits/:id/approve-payment
router.put('/admin/credits/:id/approve-payment', requireAdminKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body;
    const credit = await prisma.mlmCredit.update({
      where: { id },
      data: { payment_status: 'confirmed', admin_approved_at: new Date(), admin_note: note || null, status: 'active', activated_at: new Date() },
    });
    res.json({ success: true, credit });
  } catch (err) { console.error('[mlm/credits/approve]', err); res.status(500).json({ error: 'Failed to approve credit' }); }
});

// PUT /api/mlm/admin/credits/:id/reject-payment
router.put('/admin/credits/:id/reject-payment', requireAdminKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body;
    const credit = await prisma.mlmCredit.update({
      where: { id },
      data: { payment_status: 'rejected', admin_note: note || null, status: 'rejected' },
    });
    res.json({ success: true, credit });
  } catch (err) { console.error('[mlm/credits/reject]', err); res.status(500).json({ error: 'Failed to reject credit' }); }
});

export default router;
