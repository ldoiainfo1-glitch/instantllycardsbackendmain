import { Router, Request, Response, RequestHandler } from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import prisma from '../utils/prisma';
import { getIo } from '../utils/socket';
import {
  getDashboardCounts,
  getPendingPromotions,
  approvePromotion,
  rejectPromotion,
  listUsers,
  listAdCampaigns,
  approveAdCampaign,
  rejectAdCampaign,
  listBusinesses,
  approveBusinessCard,
  rejectBusinessCard,
  listEvents,
  listVouchers,
  listReviews,
} from '../controllers/adminController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.use(authenticate, requireRole('admin'));

router.get('/dashboard', h(getDashboardCounts));
router.get('/users', h(listUsers));

// Promotions
router.get('/promotions/pending', h(getPendingPromotions));
router.post('/promotions/:id/approve', h(approvePromotion));
router.post('/promotions/:id/reject', h(rejectPromotion));

// Listings
router.get('/businesses', h(listBusinesses));
router.post('/businesses/:id/approve', h(approveBusinessCard));
router.post('/businesses/:id/reject', h(rejectBusinessCard));
router.get('/events', h(listEvents));
router.get('/vouchers', h(listVouchers));
router.get('/reviews', h(listReviews));

// Ad campaigns
router.get('/ads', h(listAdCampaigns));
router.get('/ads/:id', async (req, res) => {
  const { getAdCampaignDetails } = await import('../controllers/adminController');
  return getAdCampaignDetails(req as unknown as AuthRequest, res);
});
router.post('/ads/:id/approve', h(approveAdCampaign));
router.post('/ads/:id/reject', h(rejectAdCampaign));
router.post('/ads/:id/pause', async (req, res) => {
  const { pauseAdCampaign } = await import('../controllers/adminController');
  return pauseAdCampaign(req as unknown as AuthRequest, res);
});
router.post('/ads/:id/resume', async (req, res) => {
  const { resumeAdCampaign } = await import('../controllers/adminController');
  return resumeAdCampaign(req as unknown as AuthRequest, res);
});
router.post('/ads/:id/delete', async (req, res) => {
  const { deleteAdCampaign } = await import('../controllers/adminController');
  return deleteAdCampaign(req as unknown as AuthRequest, res);
});

// ── Credit management ─────────────────────────────────────────────────────────

function randomAlphaNumeric(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// POST /api/admin/transfer-credits
router.post('/transfer-credits', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amount, note } = req.body;
    const creditAmount = Number(amount);
    if (!userId || !creditAmount) {
      res.status(400).json({ error: 'userId and amount are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const newBalance = Number(user.credits ?? 0) + creditAmount;
    await prisma.user.update({ where: { id: Number(userId) }, data: { credits: BigInt(newBalance) } });

    await prisma.transaction.create({
      data: {
        type: 'admin_adjustment',
        transaction_id: 'TXN' + randomAlphaNumeric(9),
        to_user_id: Number(userId),
        amount: creditAmount,
        description: note || 'Admin credit adjustment',
        status: 'completed',
      },
    });

    const io = getIo();
    io?.emit(`credits_updated_${userId}`, { credits: newBalance });

    res.json({ success: true, newBalance });
  } catch (err) {
    console.error('[admin/transfer-credits]', err);
    res.status(500).json({ error: 'Failed to transfer credits' });
  }
});

// PUT /api/admin/users/:id/update-credits
router.put('/users/:id/update-credits', async (req: Request, res: Response): Promise<void> => {
  try {
    const { credits } = req.body;
    const userId = Number(req.params.id);
    const newCredits = Number(credits);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const diff = newCredits - Number(user.credits ?? 0);
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { credits: BigInt(newCredits) },
    });

    if (diff !== 0) {
      await prisma.transaction.create({
        data: {
          type: 'admin_adjustment',
          transaction_id: 'TXN' + randomAlphaNumeric(9),
          ...(diff > 0 ? { to_user_id: userId } : { from_user_id: userId }),
          amount: Math.abs(diff),
          description: 'Admin credit update',
          status: 'completed',
        },
      });
    }

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error('[admin/update-credits]', err);
    res.status(500).json({ error: 'Failed to update credits' });
  }
});

// GET /api/admin/all-transactions
router.get('/all-transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const typeFilter = req.query.type as string | undefined;
    const userIdFilter = req.query.userId ? Number(req.query.userId) : undefined;

    const where: any = {};
    if (typeFilter) where.type = typeFilter;
    if (userIdFilter) {
      where.OR = [{ from_user_id: userIdFilter }, { to_user_id: userIdFilter }];
    }

    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          from_user: { select: { id: true, name: true, phone: true } },
          to_user: { select: { id: true, name: true, phone: true } },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({ transactions: rows, totalPages: Math.ceil(total / limit), currentPage: page, total });
  } catch (err) {
    console.error('[admin/all-transactions]', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
