import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';
import { normalizePhone, phoneVariants } from '../utils/phone';
import { getIO } from '../services/socketService';
import { sendExpoPushNotification } from '../utils/push';

export async function listVouchers(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);

  const vouchers = await prisma.voucher.findMany({
    where: { status: 'active' },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { business: { select: { id: true, company_name: true, logo_url: true } } },
  });
  res.json({ data: vouchers, page, limit });
}

export async function getVoucher(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const voucher = await prisma.voucher.findUnique({
    where: { id },
    include: { business: true },
  });
  if (!voucher) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(voucher);
}

export async function createVoucher(req: AuthRequest, res: Response): Promise<void> {
  const {
    business_id,
    title,
    description,
    discount_type,
    discount_value,
    code,
    max_claims,
    expires_at,
  } = req.body;

  const businessId = parseInt(business_id, 10);
  if (!businessId || !title) {
    res.status(400).json({ error: 'business_id and title are required' });
    return;
  }

  const card = await prisma.businessCard.findUnique({ where: { id: businessId } });
  if (!card) {
    res.status(404).json({ error: 'Business card not found' });
    return;
  }

  if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const discountValue = parseFloat(discount_value);
  if (Number.isNaN(discountValue)) {
    res.status(400).json({ error: 'discount_value must be a number' });
    return;
  }

  const voucher = await prisma.voucher.create({
    data: {
      business_id: card.id,
      business_name: card.company_name || card.full_name,
      title,
      description: description || null,
      discount_type: discount_type || 'flat',
      discount_value: discountValue,
      code: code || null,
      max_claims: max_claims ? parseInt(max_claims, 10) : null,
      expires_at: expires_at ? new Date(expires_at) : null,
      status: 'active',
      owner_user_id: req.user!.userId,
    },
  });
  res.status(201).json(voucher);
}

export async function claimVoucher(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const voucher = await prisma.voucher.findUnique({ where: { id } });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }
  if (voucher.status !== 'active') { res.status(400).json({ error: 'Voucher not active' }); return; }
  if (voucher.max_claims && voucher.claimed_count >= voucher.max_claims) {
    res.status(400).json({ error: 'Voucher fully claimed' }); return;
  }

  const alreadyClaimed = await prisma.voucherClaim.findFirst({
    where: { voucher_id: id, user_id: req.user!.userId },
  });
  if (alreadyClaimed) { res.status(409).json({ error: 'Already claimed' }); return; }

  const [claim] = await prisma.$transaction([
    prisma.voucherClaim.create({ data: { voucher_id: id, user_id: req.user!.userId } }),
    prisma.voucher.update({ where: { id }, data: { claimed_count: { increment: 1 } } }),
  ]);

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

  res.status(201).json(claim);
}

export async function transferVoucher(req: AuthRequest, res: Response): Promise<void> {
  const { voucher_id, recipient_phone } = req.body;
  const vId = parseInt(voucher_id, 10);

  const voucher = await prisma.voucher.findUnique({ where: { id: vId } });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }

  const claim = await prisma.voucherClaim.findFirst({
    where: { voucher_id: vId, user_id: req.user!.userId },
  });
  if (!claim) { res.status(403).json({ error: 'You do not own this voucher claim' }); return; }

  const variants = phoneVariants(recipient_phone || '');
  const recipient = await prisma.user.findFirst({
    where: { OR: variants.map((p) => ({ phone: p })) },
  });
  if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }

  const sender = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  const normalizedRecipientPhone = normalizePhone(recipient_phone);

  const transfer = await prisma.voucherTransfer.create({
    data: {
      voucher_id: vId,
      sender_id: req.user!.userId,
      recipient_id: recipient.id,
      sender_phone: sender!.phone,
      recipient_phone: normalizedRecipientPhone,
    },
  });

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
  const claims = await prisma.voucherClaim.findMany({
    where: { user_id: req.user!.userId },
    include: {
      voucher: { include: { business: { select: { id: true, company_name: true, logo_url: true } } } },
    },
    orderBy: { claimed_at: 'desc' },
  });
  res.json(claims);
}

export async function getMyCreatedVouchers(req: AuthRequest, res: Response): Promise<void> {
  const cards = await prisma.businessCard.findMany({
    where: { user_id: req.user!.userId },
    select: { id: true },
  });
  const cardIds = cards.map((c) => c.id);

  const vouchers = await prisma.voucher.findMany({
    where: {
      OR: [
        { owner_user_id: req.user!.userId },
        { business_id: { in: cardIds } },
      ],
    },
    orderBy: { created_at: 'desc' },
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
