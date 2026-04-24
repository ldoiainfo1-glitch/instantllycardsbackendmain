import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';
import { normalizePhone, phoneVariants } from '../utils/phone';
import { getIO } from '../services/socketService';
import { sendExpoPushNotification } from '../utils/push';

function parseOptionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getVoucherExpiry(voucher: { expiry_date?: Date | null; expires_at?: Date | null }): Date | null {
  return voucher.expiry_date ?? voucher.expires_at ?? null;
}

export async function listVouchers(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const now = new Date();

  const vouchers = await prisma.voucher.findMany({
    where: {
      status: 'active',
      OR: [
        { expiry_date: null },
        { expiry_date: { gt: now } },
        { AND: [{ expiry_date: null }, { expires_at: null }] },
        { AND: [{ expiry_date: null }, { expires_at: { gt: now } }] },
      ],
    },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: {
      business_promotion: { select: { id: true, business_name: true, tier: true, status: true, payment_status: true } },
    },
  });
  res.json({ data: vouchers, page, limit });
}

export async function getVoucher(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const voucher = await prisma.voucher.findUnique({
    where: { id },
    include: { business_promotion: true },
  });
  if (!voucher) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(voucher);
}

export async function createVoucher(req: AuthRequest, res: Response): Promise<void> {
  const {
    business_promotion_id,
    promotionId,
    title,
    description,
    discount_type,
    discount_value,
    code,
    max_claims,
    expires_at,
  } = req.body;

  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  const inputPromotionId = parseOptionalInt(business_promotion_id ?? promotionId);

  const promo = inputPromotionId
    ? await prisma.businessPromotion.findUnique({
        where: { id: inputPromotionId },
        select: {
          id: true,
          user_id: true,
          status: true,
          payment_status: true,
          business_name: true,
          business_card_id: true,
        },
      })
    : null;

  if (!promo) {
    res.status(400).json({ error: 'business_promotion_id is required' });
    return;
  }

  if (promo.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (promo.status !== 'active') {
    res.status(409).json({ error: 'Promotion must be active to create vouchers' });
    return;
  }

  if (promo.payment_status !== 'completed') {
    res.status(409).json({ error: 'Promotion payment must be completed to create vouchers' });
    return;
  }

  const discountValue = parseFloat(discount_value);
  if (Number.isNaN(discountValue)) {
    res.status(400).json({ error: 'discount_value must be a number' });
    return;
  }

  const parsedExpiry = expires_at ? new Date(expires_at) : null;

  const voucher = await prisma.voucher.create({
    data: {
      business_id: promo.business_card_id ?? undefined,
      business_promotion_id: promo.id,
      business_name: promo.business_name,
      title,
      description: description || null,
      discount_type: discount_type || 'flat',
      discount_value: discountValue,
      code: code || null,
      max_claims: max_claims ? parseInt(max_claims, 10) : null,
      expires_at: parsedExpiry,
      expiry_date: parsedExpiry,
      status: 'active',
      owner_user_id: req.user!.userId,
    },
  });
  res.status(201).json(voucher);
}

export async function claimVoucher(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const voucher = await prisma.voucher.findUnique({ where: { id }, select: { id: true, title: true, status: true, max_claims: true, claimed_count: true, owner_user_id: true, expiry_date: true, expires_at: true } });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }
  if (voucher.status !== 'active') { res.status(400).json({ error: 'Voucher not active' }); return; }

  const expiry = getVoucherExpiry(voucher);
  if (expiry && expiry <= new Date()) {
    res.status(400).json({ error: 'Voucher expired' });
    return;
  }

  if (voucher.max_claims && voucher.claimed_count >= voucher.max_claims) {
    res.status(400).json({ error: 'Voucher fully claimed' }); return;
  }

  const activeClaim = await prisma.voucherClaim.findFirst({
    where: { voucher_id: id, status: 'active' },
    select: { id: true, user_id: true },
  });
  if (activeClaim && activeClaim.user_id !== req.user!.userId) {
    res.status(409).json({ error: 'Voucher already claimed by another user' });
    return;
  }

  if (activeClaim && activeClaim.user_id === req.user!.userId) {
    res.status(409).json({ error: 'Already claimed' });
    return;
  }

  const existingUserClaim = await prisma.voucherClaim.findFirst({
    where: { voucher_id: id, user_id: req.user!.userId },
    select: { id: true },
  });
  if (existingUserClaim) { res.status(409).json({ error: 'Already claimed' }); return; }

  let claim;
  try {
    [claim] = await prisma.$transaction([
      prisma.voucherClaim.create({ data: { voucher_id: id, user_id: req.user!.userId, status: 'active' } }),
      prisma.voucher.update({ where: { id }, data: { claimed_count: { increment: 1 } } }),
    ]);
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Already claimed' });
      return;
    }
    throw err;
  }

  // Notify voucher creator
  try {
    if (voucher.owner_user_id && voucher.owner_user_id !== req.user!.userId) {
      const owner = await prisma.user.findUnique({ where: { id: voucher.owner_user_id }, select: { id: true, push_token: true } });
      const claimer = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } });
      if (owner) {
        const io = getIO();
        const payload = { type: 'voucher:claimed', voucherId: id, voucherTitle: voucher.title, claimerName: claimer?.name ?? 'Someone' };
        if (io) io.to(`user:${owner.id}`).emit('voucher:claimed', payload);
        if (owner.push_token) {
          sendExpoPushNotification(owner.push_token, 'Voucher Claimed', `${claimer?.name ?? 'Someone'} claimed your voucher "${voucher.title}"`, { screen: 'Vouchers' });
        }
      }
    }
  } catch { /* non-blocking */ }

  res.status(201).json({
    id: claim.id,
    voucher_id: claim.voucher_id,
    claimed_at: claim.claimed_at,
    status: claim.status,
  });
}

export async function transferVoucher(req: AuthRequest, res: Response): Promise<void> {
  const { voucher_id, recipient_phone } = req.body;
  const vId = parseInt(voucher_id, 10);

  const voucher = await prisma.voucher.findUnique({ where: { id: vId } });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }

  const senderClaim = await prisma.voucherClaim.findFirst({
    where: { voucher_id: vId, user_id: req.user!.userId, status: 'active' },
    orderBy: { claimed_at: 'desc' },
  });
  if (!senderClaim) { res.status(403).json({ error: 'You do not own this voucher claim' }); return; }

  if (senderClaim.redeemed_at) {
    res.status(409).json({ error: 'Redeemed vouchers cannot be transferred' });
    return;
  }

  const variants = phoneVariants(recipient_phone || '');
  const recipient = await prisma.user.findFirst({
    where: { OR: variants.map((p) => ({ phone: p })) },
  });
  if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }
  if (recipient.id === req.user!.userId) {
    res.status(409).json({ error: 'Cannot transfer voucher to yourself' });
    return;
  }

  const sender = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  const normalizedRecipientPhone = normalizePhone(recipient_phone);

  let transfer;
  try {
    transfer = await prisma.$transaction(async (tx) => {
      const activeClaim = await tx.voucherClaim.findFirst({
        where: { voucher_id: vId, status: 'active' },
        select: { id: true, user_id: true },
      });
      if (!activeClaim || activeClaim.user_id !== req.user!.userId) {
        throw new Error('ACTIVE_CLAIM_OWNERSHIP_MISMATCH');
      }

      await tx.voucherClaim.update({
        where: { id: senderClaim.id },
        data: { status: 'transferred' },
      });

      const existingActiveForRecipient = await tx.voucherClaim.findFirst({
        where: { voucher_id: vId, user_id: recipient.id, status: 'active' },
        select: { id: true },
      });
      if (existingActiveForRecipient) {
        throw new Error('RECIPIENT_ALREADY_ACTIVE_OWNER');
      }

      const existingRecipientClaim = await tx.voucherClaim.findUnique({
        where: { user_id_voucher_id: { user_id: recipient.id, voucher_id: vId } },
      });

      if (existingRecipientClaim) {
        await tx.voucherClaim.update({
          where: { id: existingRecipientClaim.id },
          data: { status: 'active', claimed_at: new Date(), redeemed_at: null },
        });
      } else {
        await tx.voucherClaim.create({
          data: { voucher_id: vId, user_id: recipient.id, status: 'active' },
        });
      }

      return tx.voucherTransfer.create({
        data: {
          voucher_id: vId,
          sender_id: req.user!.userId,
          recipient_id: recipient.id,
          sender_phone: sender!.phone,
          recipient_phone: normalizedRecipientPhone,
        },
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'ACTIVE_CLAIM_OWNERSHIP_MISMATCH') {
      res.status(409).json({ error: 'Voucher claim ownership changed. Please refresh and retry.' });
      return;
    }
    if (err instanceof Error && err.message === 'RECIPIENT_ALREADY_ACTIVE_OWNER') {
      res.status(409).json({ error: 'Recipient already owns this voucher' });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Recipient already has this voucher' });
      return;
    }
    throw err;
  }

  // Notify recipient about the voucher transfer
  try {
    const recipientUser = await prisma.user.findUnique({ where: { id: recipient.id }, select: { id: true, push_token: true } });
    if (recipientUser) {
      const io = getIO();
      const payload = { type: 'voucher:transferred', transferId: transfer.id, voucherId: vId, voucherTitle: voucher.title, senderName: sender?.name ?? 'Someone' };
      if (io) io.to(`user:${recipientUser.id}`).emit('voucher:transferred', payload);
      if (recipientUser.push_token) {
        sendExpoPushNotification(recipientUser.push_token, 'Voucher Received', `${sender?.name ?? 'Someone'} transferred a voucher "${voucher.title}" to you`, { screen: 'Vouchers' });
      }
    }
  } catch { /* non-blocking */ }

  res.status(201).json(transfer);
}

export async function getMyVouchers(req: AuthRequest, res: Response): Promise<void> {
  const promotionId = parseOptionalInt(req.query.promotionId);

  const claims = await prisma.voucherClaim.findMany({
    where: {
      user_id: req.user!.userId,
      ...(promotionId
        ? { voucher: { business_promotion_id: promotionId } }
        : {}),
    },
    include: {
      voucher: {
        include: {
          business_promotion: { select: { id: true, business_name: true, tier: true, status: true, payment_status: true } },
        },
      },
    },
    orderBy: { claimed_at: 'desc' },
  });
  res.json(claims);
}

export async function getMyCreatedVouchers(req: AuthRequest, res: Response): Promise<void> {
  const promotionId = parseOptionalInt(req.query.promotionId);

  const promotions = await prisma.businessPromotion.findMany({
    where: { user_id: req.user!.userId },
    select: { id: true },
  });
  const promotionIds = promotions.map((p) => p.id);

  if (promotionId && !promotionIds.includes(promotionId)) {
    res.status(403).json({ error: 'Forbidden for this promotion' });
    return;
  }

  const vouchers = await prisma.voucher.findMany({
    where: {
      ...(promotionId
        ? { business_promotion_id: promotionId }
        : { business_promotion_id: { in: promotionIds } }),
    },
    orderBy: { created_at: 'desc' },
    include: { business_promotion: { select: { id: true, business_name: true, tier: true, status: true, payment_status: true } } },
  });
  res.json(vouchers);
}

export async function getMyTransfers(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const transfers = await prisma.voucherTransfer.findMany({
    where: { OR: [{ sender_id: userId }, { recipient_id: userId }] },
    orderBy: { transferred_at: 'desc' },
  });
  res.json(transfers);
}

export async function updateVoucherStatus(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const { status } = req.body;
  const allowed = ['active', 'inactive', 'draft'];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    return;
  }

  const voucher = await prisma.voucher.findUnique({
    where: { id },
    select: { id: true, business_promotion_id: true, business_promotion: { select: { user_id: true } } },
  });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }

  if (voucher.business_promotion.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Not your voucher' });
    return;
  }

  const updated = await prisma.voucher.update({
    where: { id },
    data: { status },
    include: { business_promotion: { select: { id: true, business_name: true, tier: true, status: true, payment_status: true } } },
  });
  res.json(updated);
}

export async function redeemVoucher(req: AuthRequest, res: Response): Promise<void> {
  const voucherId = parseOptionalInt(req.body.voucher_id);
  if (!voucherId) {
    res.status(400).json({ error: 'voucher_id is required' });
    return;
  }

  const voucher = await prisma.voucher.findUnique({
    where: { id: voucherId },
    select: { id: true, status: true, expiry_date: true, expires_at: true },
  });
  if (!voucher) {
    res.status(404).json({ error: 'Voucher not found' });
    return;
  }

  if (voucher.status !== 'active') {
    res.status(400).json({ error: 'Voucher not active' });
    return;
  }

  const expiry = getVoucherExpiry(voucher);
  if (expiry && expiry <= new Date()) {
    res.status(400).json({ error: 'Voucher expired' });
    return;
  }

  const claim = await prisma.voucherClaim.findFirst({
    where: { voucher_id: voucherId, user_id: req.user!.userId },
    orderBy: { claimed_at: 'desc' },
  });

  if (!claim) {
    res.status(404).json({ error: 'Voucher claim not found' });
    return;
  }

  if (claim.status === 'redeemed' || claim.redeemed_at) {
    res.status(200).json({
      id: claim.id,
      voucher_id: claim.voucher_id,
      claimed_at: claim.claimed_at,
      redeemed_at: claim.redeemed_at,
      status: 'redeemed',
      idempotent: true,
    });
    return;
  }

  if (claim.status !== 'active') {
    res.status(409).json({ error: 'Only active voucher claims can be redeemed' });
    return;
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.voucherClaim.updateMany({
      where: { id: claim.id, status: 'active', redeemed_at: null },
      data: { status: 'redeemed', redeemed_at: now },
    });

    if (updateResult.count === 0) {
      const existing = await tx.voucherClaim.findUnique({ where: { id: claim.id } });
      if (!existing) throw new Error('CLAIM_NOT_FOUND');
      return existing;
    }

    await tx.voucherRedemption.upsert({
      where: { voucher_id_used_by_id: { voucher_id: voucherId, used_by_id: req.user!.userId } },
      update: {},
      create: {
        voucher_id: voucherId,
        used_by_id: req.user!.userId,
        used_at: now,
      },
    });

    const next = await tx.voucherClaim.findUnique({ where: { id: claim.id } });
    if (!next) throw new Error('CLAIM_NOT_FOUND');
    return next;
  });

  res.json({
    id: updated.id,
    voucher_id: updated.voucher_id,
    claimed_at: updated.claimed_at,
    redeemed_at: updated.redeemed_at,
    status: updated.status,
  });
}
