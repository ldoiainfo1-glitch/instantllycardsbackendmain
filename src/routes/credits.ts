import { Router, Response, RequestHandler } from 'express';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendExpoPushNotification } from '../utils/push';

const router = Router();

// ── Public routes (no auth required) ─────────────────────────────────────────

/**
 * GET /config — returns the credit configuration (signup bonus, referral reward, etc.)
 */
router.get('/config', async (_req, res: Response) => {
  try {
    const config = await prisma.creditConfig.findFirst();
    res.json({
      signup_bonus: config?.signup_bonus ?? 0,
      referral_reward: config?.referral_reward ?? 300,
    });
  } catch (err) {
    console.error('[credits/config]', err);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ── Authenticated routes ─────────────────────────────────────────────────────
router.use(authenticate as RequestHandler);

// ── helpers ──────────────────────────────────────────────────────────────────

function randomAlphaNumeric(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function generateUniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomAlphaNumeric(6);
    const exists = await prisma.user.findFirst({ where: { referral_code: code } });
    if (!exists) return code;
  }
  return randomAlphaNumeric(6) + Date.now().toString(36).slice(-2).toUpperCase();
}

function generateTransactionId(): string {
  return 'TXN' + randomAlphaNumeric(9);
}

function daysRemaining(expiry: Date): number {
  const now = new Date();
  const diff = expiry.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ── GET /balance ──────────────────────────────────────────────────────────────

router.get('/balance', (async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { credits: true, credits_expiry_date: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const now = new Date();
    if (user.credits_expiry_date && user.credits_expiry_date < now) {
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { credits: BigInt(0), credits_expiry_date: null },
      });
      res.json({ credits: 0, creditsExpiryDate: user.credits_expiry_date, expired: true });
      return;
    }

    res.json({
      credits: Number(user.credits ?? 0),
      creditsExpiryDate: user.credits_expiry_date,
      daysRemaining: user.credits_expiry_date ? daysRemaining(user.credits_expiry_date) : null,
      expired: false,
    });
  } catch (err) {
    console.error('[credits/balance]', err);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
}) as unknown as RequestHandler);

// ── GET /transactions ─────────────────────────────────────────────────────────

router.get('/transactions', (async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const userId = req.user!.userId;

    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { OR: [{ from_user_id: userId }, { to_user_id: userId }] },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          from_user: { select: { id: true, name: true, phone: true } },
          to_user: { select: { id: true, name: true, phone: true } },
        },
      }),
      prisma.transaction.count({
        where: { OR: [{ from_user_id: userId }, { to_user_id: userId }] },
      }),
    ]);

    const transactions = rows.map((tx) => {
      let type = tx.type;
      let amount = tx.amount;
      if (tx.type === 'transfer') {
        if (tx.from_user_id === userId) {
          type = 'transfer_sent';
          amount = -Math.abs(amount);
        } else {
          type = 'transfer_received';
          amount = Math.abs(amount);
        }
      }
      return { ...tx, type, amount };
    });

    res.json({ transactions, totalPages: Math.ceil(total / limit), currentPage: page });
  } catch (err) {
    console.error('[credits/transactions]', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}) as unknown as RequestHandler);

// ── GET /history ──────────────────────────────────────────────────────────────

router.get('/history', (async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10)));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true, credits_expiry_date: true, name: true, phone: true },
    });

    const rows = await prisma.transaction.findMany({
      where: { OR: [{ from_user_id: userId }, { to_user_id: userId }] },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        from_user: { select: { id: true, name: true, phone: true } },
        to_user: { select: { id: true, name: true, phone: true } },
      },
    });

    let transferReceived = 0;
    let transferSent = 0;
    let adDeductions = 0;

    // Compute breakdown from ALL transactions
    for (const tx of rows) {
      if (tx.type === 'transfer' || tx.type === 'transfer_sent' || tx.type === 'transfer_received') {
        const isSent = tx.from_user_id === userId || tx.type === 'transfer_sent';
        if (isSent) transferSent += Math.abs(tx.amount);
        else transferReceived += Math.abs(tx.amount);
      } else if (tx.type === 'ad_deduction') {
        adDeductions += Math.abs(tx.amount);
      }
    }

    const transactions = rows.map((tx) => {
      let type = tx.type;
      let amount = tx.amount;
      if (tx.type === 'transfer') {
        if (tx.from_user_id === userId) {
          type = 'transfer_sent';
          amount = -Math.abs(amount);
        } else {
          type = 'transfer_received';
          amount = Math.abs(amount);
        }
      } else if (tx.type === 'transfer_sent') {
        amount = -Math.abs(amount);
      } else if (tx.type === 'transfer_received') {
        amount = Math.abs(amount);
      }
      return { ...tx, type, amount };
    });

    res.json({
      success: true,
      totalCredits: Number(user?.credits ?? 0),
      breakdown: {
        transferReceived,
        transferSent,
        adDeductions,
        quizCredits: 0,
        referralCredits: 0,
        signupBonus: 0,
        selfDownloadCredits: 0,
      },
      transactions,
    });
  } catch (err) {
    console.error('[credits/history]', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}) as unknown as RequestHandler);

// ── POST /search-users ────────────────────────────────────────────────────────

router.post('/search-users', (async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      res.status(400).json({ error: 'phone is required' });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        phone: { contains: phone, mode: 'insensitive' },
        NOT: { id: req.user!.userId },
      },
      select: { id: true, name: true, phone: true, profile_picture: true },
      take: 20,
    });

    res.json({
      users: users.map((u) => ({
        _id: u.id,
        name: u.name,
        phone: u.phone,
        profilePic: u.profile_picture,
      })),
    });
  } catch (err) {
    console.error('[credits/search-users]', err);
    res.status(500).json({ error: 'Search failed' });
  }
}) as unknown as RequestHandler);

// ── POST /transfer ────────────────────────────────────────────────────────────

router.post('/transfer', (async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId, amount, note } = req.body;
    const senderId = req.user!.userId;
    const transferAmount = Number(amount);

    if (Number(recipientId) === senderId) {
      res.status(400).json({ error: 'Cannot transfer to yourself' });
      return;
    }
    if (!transferAmount || transferAmount < 10) {
      res.status(400).json({ error: 'Minimum transfer amount is 10 credits' });
      return;
    }

    const [sender, recipient] = await Promise.all([
      prisma.user.findUnique({ where: { id: senderId } }),
      prisma.user.findUnique({ where: { id: Number(recipientId) } }),
    ]);

    if (!sender) { res.status(404).json({ error: 'Sender not found' }); return; }
    if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }

    const now = new Date();
    if (sender.credits_expiry_date && sender.credits_expiry_date < now) {
      res.status(400).json({ error: 'Your credits have expired' });
      return;
    }

    const senderBalance = Number(sender.credits ?? 0);
    if (senderBalance < transferAmount) {
      res.status(400).json({ error: 'Insufficient credits' });
      return;
    }

    const balanceBefore = senderBalance;
    const newSenderBalance = senderBalance - transferAmount;
    const newRecipientBalance = Number(recipient.credits ?? 0) + transferAmount;
    const transactionId = generateTransactionId();

    await prisma.$transaction([
      prisma.user.update({
        where: { id: senderId },
        data: { credits: BigInt(newSenderBalance) },
      }),
      prisma.user.update({
        where: { id: Number(recipientId) },
        data: { credits: BigInt(newRecipientBalance) },
      }),
      prisma.transaction.create({
        data: {
          type: 'transfer',
          transaction_id: transactionId,
          from_user_id: senderId,
          to_user_id: Number(recipientId),
          amount: transferAmount,
          description: `Credit transfer from ${sender.name ?? sender.phone} to ${recipient.name ?? recipient.phone}`,
          note: note ?? null,
          balance_before: balanceBefore,
          balance_after: newSenderBalance,
          status: 'completed',
        },
      }),
      prisma.notification.create({
        data: {
          user_id: Number(recipientId),
          title: 'Credits Received',
          description: `You received ${transferAmount} credits from ${sender.name ?? sender.phone}`,
          type: 'credit_transfer',
        },
      }),
    ]);

    // Push notification (best-effort, non-blocking)
    if (recipient.push_token) {
      sendExpoPushNotification(
        recipient.push_token,
        'Credits Received',
        `You received ${transferAmount} credits from ${sender.name ?? sender.phone}`
      ).catch(() => {});
    }

    res.json({ success: true, newBalance: newSenderBalance, transactionId });
  } catch (err) {
    console.error('[credits/transfer]', err);
    res.status(500).json({ error: 'Transfer failed' });
  }
}) as unknown as RequestHandler);

// ── Referral stats ───────────────────────────────────────────────────────────

/**
 * GET /referral-stats — returns the current user's referral code, total referrals, and credits earned from referrals
 * Auto-generates a referral code for existing users who don't have one.
 */
router.get('/referral-stats', (async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referral_code: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Auto-generate referral code for existing users who don't have one
    if (!user.referral_code) {
      const newCode = await generateUniqueReferralCode();
      await prisma.user.update({
        where: { id: userId },
        data: { referral_code: newCode },
      });
      user = { referral_code: newCode };
    }

    const [totalReferrals, creditsEarned] = await Promise.all([
      prisma.referral.count({ where: { referrer_id: userId } }),
      prisma.transaction.aggregate({
        where: { to_user_id: userId, type: 'referral_bonus', status: 'completed' },
        _sum: { amount: true },
      }),
    ]);

    res.json({
      referralCode: user.referral_code,
      totalReferrals,
      totalCreditsEarned: creditsEarned._sum.amount ?? 0,
    });
  } catch (err) {
    console.error('[credits/referral-stats]', err);
    res.status(500).json({ error: 'Failed to fetch referral stats' });
  }
}) as unknown as RequestHandler);

/**
 * GET /referral-history — returns paginated list of individual referrals for the current user
 */
router.get('/referral-history', (async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));

    const [referrals, total] = await Promise.all([
      prisma.referral.findMany({
        where: { referrer_id: userId },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          referred: {
            select: { id: true, name: true, profile_picture: true, created_at: true },
          },
        },
      }),
      prisma.referral.count({ where: { referrer_id: userId } }),
    ]);

    // For each referral, find the bonus transaction amount
    const referralData = await Promise.all(
      referrals.map(async (r) => {
        const bonusTx = await prisma.transaction.findFirst({
          where: {
            to_user_id: userId,
            from_user_id: r.referred_id,
            type: 'referral_bonus',
            status: 'completed',
          },
          select: { amount: true },
        });
        return {
          id: r.id,
          referredUser: {
            id: r.referred.id,
            name: r.referred.name,
            profilePicture: r.referred.profile_picture,
          },
          status: r.status,
          rewardGiven: r.reward_given,
          creditsEarned: bonusTx?.amount ?? 0,
          createdAt: r.created_at,
        };
      })
    );

    res.json({
      referrals: referralData,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      totalReferrals: total,
    });
  } catch (err) {
    console.error('[credits/referral-history]', err);
    res.status(500).json({ error: 'Failed to fetch referral history' });
  }
}) as unknown as RequestHandler);

/**
 * GET /earnings-history — returns paginated list of referral bonus transactions
 */
router.get('/earnings-history', (async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));

    const [transactions, total, totalEarned] = await Promise.all([
      prisma.transaction.findMany({
        where: { to_user_id: userId, type: 'referral_bonus', status: 'completed' },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          amount: true,
          description: true,
          created_at: true,
          transaction_id: true,
        },
      }),
      prisma.transaction.count({
        where: { to_user_id: userId, type: 'referral_bonus', status: 'completed' },
      }),
      prisma.transaction.aggregate({
        where: { to_user_id: userId, type: 'referral_bonus', status: 'completed' },
        _sum: { amount: true },
      }),
    ]);

    res.json({
      earnings: transactions.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        description: tx.description,
        transactionId: tx.transaction_id,
        createdAt: tx.created_at,
      })),
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      totalEarnings: totalEarned._sum.amount ?? 0,
      totalTransactions: total,
    });
  } catch (err) {
    console.error('[credits/earnings-history]', err);
    res.status(500).json({ error: 'Failed to fetch earnings history' });
  }
}) as unknown as RequestHandler);

/**
 * PUT /config — admin-only: upsert credit configuration
 * Protected by x-admin-key header
 */
router.put('/config', (async (req: AuthRequest, res: Response) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { signup_bonus, referral_reward } = req.body;
    const existing = await prisma.creditConfig.findFirst();

    const config = existing
      ? await prisma.creditConfig.update({
          where: { id: existing.id },
          data: {
            ...(signup_bonus !== undefined && { signup_bonus: Number(signup_bonus) }),
            ...(referral_reward !== undefined && { referral_reward: Number(referral_reward) }),
          },
        })
      : await prisma.creditConfig.create({
          data: {
            signup_bonus: Number(signup_bonus ?? 0),
            referral_reward: Number(referral_reward ?? 300),
          },
        });

    res.json(config);
  } catch (err) {
    console.error('[credits/config PUT]', err);
    res.status(500).json({ error: 'Failed to update config' });
  }
}) as unknown as RequestHandler);

export default router;
