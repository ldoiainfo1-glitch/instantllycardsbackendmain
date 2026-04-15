import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendExpoPushNotification } from '../utils/push';

const router = Router();
router.use(authenticate);

// ── helpers ──────────────────────────────────────────────────────────────────

function randomAlphaNumeric(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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

router.get('/balance', async (req: AuthRequest, res: Response): Promise<void> => {
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
        data: { credits: BigInt(0) },
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
});

// ── GET /transactions ─────────────────────────────────────────────────────────

router.get('/transactions', async (req: AuthRequest, res: Response): Promise<void> => {
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
});

// ── GET /history ──────────────────────────────────────────────────────────────

router.get('/history', async (req: AuthRequest, res: Response): Promise<void> => {
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
});

// ── POST /search-users ────────────────────────────────────────────────────────

router.post('/search-users', async (req: AuthRequest, res: Response): Promise<void> => {
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
});

// ── POST /transfer ────────────────────────────────────────────────────────────

router.post('/transfer', async (req: AuthRequest, res: Response): Promise<void> => {
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
});

export default router;
