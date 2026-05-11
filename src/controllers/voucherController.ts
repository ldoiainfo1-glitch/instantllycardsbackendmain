import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';
import { normalizePhone, phoneVariants } from '../utils/phone';
import { getIO } from '../services/socketService';
import { sendExpoPushNotification } from '../utils/push';
import { notify } from '../utils/notify';
import { createRazorpayOrder, getRazorpayPublicKey, verifyRazorpaySignature } from '../services/razorpayService';

function parseOptionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getVoucherExpiry(voucher: { expiry_date?: Date | null; expires_at?: Date | null }): Date | null {
  return voucher.expiry_date ?? voucher.expires_at ?? null;
}

/**
 * Compute display-ready pricing fields for a voucher row and attach them
 * to the response. Mobile prefers these computed fields over raw columns.
 */
function decorateVoucher<T extends Record<string, any>>(v: T | null | undefined): T & {
  original_price: number;
  discounted_price: number;
  discount_label: string;
} | null {
  if (!v) return null;
  const original = Number(v.mrp ?? v.amount ?? 0);
  const dValue = Number(v.discount_value ?? 0);
  const dType = v.discount_type === 'percent' ? 'percent' : 'flat';
  let discounted = original;
  if (original > 0) {
    discounted = dType === 'percent'
      ? Math.max(0, original - (original * dValue) / 100)
      : Math.max(0, original - dValue);
  } else if (dType === 'flat' && dValue > 0) {
    // Legacy rows with no original price stored
    discounted = 0;
  }
  const label = dType === 'percent'
    ? `${dValue}% OFF`
    : `₹${dValue} OFF`;
  return {
    ...v,
    subtitle: v.subtitle ?? v.description ?? null,
    terms: v.terms ?? v.description ?? null,
    original_price: original,
    discounted_price: Math.round(discounted * 100) / 100,
    discount_label: v.discount_label || label,
    allows_installment: v.allows_installment ?? false,
    upfront_amount: v.upfront_amount ? Number(v.upfront_amount) : null,
  };
}

export async function listVouchers(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const now = new Date();
  // Use start-of-day so a voucher whose expiry is "today" (stored at 00:00 UTC)
  // is still considered active for the whole day.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const cityRaw = typeof req.query.city === 'string' ? req.query.city.trim() : '';
  const pincodeRaw = typeof req.query.pincode === 'string' ? req.query.pincode.trim() : '';

  const where: any = {
    status: 'active',
    OR: [
      { expiry_date: null, expires_at: null },
      { expiry_date: { gte: startOfToday } },
      { AND: [{ expiry_date: null }, { expires_at: { gte: startOfToday } }] },
    ],
  };

  // Location-based filter: match user's city (case-insensitive contains, so
  // "Mumbai" matches "Mumbai Suburban" etc.) OR exact pincode. Legacy vouchers
  // without city/pincode are still included so older records remain visible.
  const locationOr: any[] = [];
  if (cityRaw) {
    locationOr.push({ city: { contains: cityRaw, mode: 'insensitive' } });
  }
  if (pincodeRaw) {
    locationOr.push({ pincode: pincodeRaw });
  }
  if (locationOr.length > 0) {
    locationOr.push({ AND: [{ city: null }, { pincode: null }] });
    where.AND = [{ OR: locationOr }];
  }

  const vouchers = await prisma.voucher.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: {
      business_promotion: { select: { id: true, business_name: true, tier: true, status: true, payment_status: true } },
    },
  });
  res.json({ data: vouchers.map(decorateVoucher), page, limit });
}

export async function getVoucher(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  if (!id || isNaN(id)) { res.status(404).json({ error: 'Not found' }); return; }
  const voucher = await prisma.voucher.findUnique({
    where: { id },
    include: { business_promotion: true },
  });
  if (!voucher) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(decorateVoucher(voucher));
}

export async function createVoucher(req: AuthRequest, res: Response): Promise<void> {
  const {
    business_promotion_id,
    promotionId,
    title,
    subtitle,
    description,
    discount_type,
    discount_value,
    code,
    min_claim,
    min_vouchers_required,
    max_claims,
    expires_at,
    original_price,
    mrp,
    allows_installment,
    upfront_amount,
    company_name,
    phone_number,
    address,
    city,
    pincode,
    voucher_image,
    voucher_banner,
    what_we_do,
    website,
    terms,
    is_popular,
  } = req.body;

  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (!city || typeof city !== 'string' || !city.trim()) {
    res.status(400).json({ error: 'city is required' });
    return;
  }
  if (!pincode || typeof pincode !== 'string' || !pincode.trim()) {
    res.status(400).json({ error: 'pincode is required' });
    return;
  }
  // Reject local/non-http URIs for image fields
  const isWebUrlOrEmpty = (u: any) => !u || (typeof u === 'string' && /^https?:\/\//i.test(u));
  if (!isWebUrlOrEmpty(voucher_image)) {
    res.status(400).json({ error: 'voucher_image must be a public https URL. Upload via /api/uploads/image first.' });
    return;
  }
  if (!isWebUrlOrEmpty(voucher_banner)) {
    res.status(400).json({ error: 'voucher_banner must be a public https URL. Upload via /api/uploads/image first.' });
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

  // Vouchers are available on every active promotion (free or paid).
  // Tier/payment gating intentionally removed so any business can offer vouchers.

  const discountValue = parseFloat(discount_value);
  if (Number.isNaN(discountValue)) {
    res.status(400).json({ error: 'discount_value must be a number' });
    return;
  }

  const parsedExpiry = expires_at ? new Date(expires_at) : null;

  // Accept either `original_price` or `mrp` for the pre-discount price.
  const rawOriginal = original_price ?? mrp;
  const parsedOriginal = rawOriginal !== undefined && rawOriginal !== null && rawOriginal !== ''
    ? Number(rawOriginal)
    : null;
  const finalOriginal = parsedOriginal !== null && !Number.isNaN(parsedOriginal) && parsedOriginal >= 0
    ? parsedOriginal
    : null;

  const parsedUpfront = upfront_amount ? parseFloat(upfront_amount) : null;
  if (allows_installment && (!parsedUpfront || parsedUpfront <= 0)) {
    res.status(400).json({ error: 'upfront_amount is required when allows_installment is true' });
    return;
  }

  const normalizedDescription = description || subtitle || terms || null;

  const voucher = await prisma.voucher.create({
    data: {
      business_id: promo.business_card_id ?? undefined,
      business_promotion_id: promo.id,
      business_name: promo.business_name,
      title,
      subtitle: subtitle || null,
      description: normalizedDescription,
      discount_type: discount_type || 'flat',
      discount_value: discountValue,
      code: code || null,
      min_vouchers_required: (min_claim ?? min_vouchers_required)
        ? parseInt(min_claim ?? min_vouchers_required, 10)
        : null,
      max_claims: max_claims ? parseInt(max_claims, 10) : null,
      expires_at: parsedExpiry,
      expiry_date: parsedExpiry,
      status: 'active',
      owner_user_id: req.user!.userId,
      mrp: finalOriginal,
      amount: finalOriginal,
      allows_installment: allows_installment === true || allows_installment === 'true',
      upfront_amount: parsedUpfront,
      company_name: company_name || null,
      phone_number: phone_number || null,
      address: address || null,
      city: city.trim(),
      pincode: pincode.trim(),
      terms: terms || null,
      voucher_image: voucher_image || null,
      voucher_banner: voucher_banner || null,
      what_we_do: what_we_do || null,
      website: website || null,
      is_published: is_popular === true || is_popular === 'true' ? true : null,
    },
  });
  res.status(201).json(decorateVoucher(voucher));
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

  // Multiple users can claim the same voucher (subject to max_claims/expiry).
  // Only block if THIS user has already claimed it.
  const existingUserClaim = await prisma.voucherClaim.findFirst({
    where: { voucher_id: id, user_id: req.user!.userId },
    select: { id: true, status: true },
  });
  if (existingUserClaim) {
    res.status(409).json({ error: 'Already claimed' });
    return;
  }

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
        await notify({
          pushToken: owner.push_token,
          userId: owner.id,
          title: 'Voucher Claimed',
          body: `${claimer?.name ?? 'Someone'} claimed your voucher "${voucher.title}"`,
          type: 'voucher_claimed',
          data: { screen: 'Vouchers' },
        });
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
  const transferQty = Math.max(1, Math.floor(Number(req.body.quantity ?? 1)));

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

  const senderRemaining = (senderClaim.quantity ?? 1) - (senderClaim.redeemed_count ?? 0);
  if (transferQty > senderRemaining) {
    res.status(400).json({ error: `You only have ${senderRemaining} unredeemed voucher(s) to transfer` });
    return;
  }

  const variants = phoneVariants(recipient_phone || '');
  const recipient = await prisma.user.findFirst({
    where: { OR: variants.map((p) => ({ phone: p })) },
  });
  if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }
  if (recipient.id === req.user!.userId) {
    res.status(400).json({ error: 'You cannot transfer a voucher to yourself' }); return;
  }

  const sender = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  const normalizedRecipientPhone = normalizePhone(recipient_phone);
  const fullyTransferred = transferQty >= senderRemaining;

  let transfer;
  try {
    transfer = await prisma.$transaction(async (tx) => {
      // Re-check sender's claim inside transaction to avoid race conditions
      const activeClaim = await tx.voucherClaim.findFirst({
        where: { voucher_id: vId, user_id: req.user!.userId, status: 'active' },
        select: { id: true, quantity: true, redeemed_count: true },
      });
      if (!activeClaim) throw new Error('ACTIVE_CLAIM_OWNERSHIP_MISMATCH');

      const currentRemaining = (activeClaim.quantity ?? 1) - (activeClaim.redeemed_count ?? 0);
      if (transferQty > currentRemaining) throw new Error('INSUFFICIENT_REMAINING');

      if (fullyTransferred) {
        // Mark entire claim as transferred
        await tx.voucherClaim.update({
          where: { id: senderClaim.id },
          data: { status: 'transferred' },
        });
      } else {
        // Reduce sender's quantity by transferQty (keeps the claim active)
        await tx.voucherClaim.update({
          where: { id: senderClaim.id },
          data: { quantity: { decrement: transferQty } },
        });
      }

      // Give recipient their vouchers (create or increment their claim)
      const existingRecipientClaim = await tx.voucherClaim.findUnique({
        where: { user_id_voucher_id: { user_id: recipient.id, voucher_id: vId } },
      });

      if (existingRecipientClaim) {
        if (existingRecipientClaim.status === 'active') {
          // Add to their existing active claim
          await tx.voucherClaim.update({
            where: { id: existingRecipientClaim.id },
            data: { quantity: { increment: transferQty } },
          });
        } else {
          // Reactivate their old claim and top up quantity
          await tx.voucherClaim.update({
            where: { id: existingRecipientClaim.id },
            data: { status: 'active', claimed_at: new Date(), redeemed_at: null, quantity: { increment: transferQty } },
          });
        }
      } else {
        await tx.voucherClaim.create({
          data: { voucher_id: vId, user_id: recipient.id, status: 'active', quantity: transferQty },
        });
      }

      return tx.voucherTransfer.create({
        data: {
          voucher_id: vId,
          sender_id: req.user!.userId,
          recipient_id: recipient.id,
          sender_phone: sender!.phone,
          recipient_phone: normalizedRecipientPhone,
          quantity: transferQty,
        },
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'ACTIVE_CLAIM_OWNERSHIP_MISMATCH') {
      res.status(409).json({ error: 'Voucher claim ownership changed. Please refresh and retry.' });
      return;
    }
    if (err instanceof Error && err.message === 'INSUFFICIENT_REMAINING') {
      res.status(409).json({ error: 'Not enough unredeemed vouchers to transfer. Please refresh and retry.' });
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
      const payload = { type: 'voucher:transferred', transferId: transfer.id, voucherId: vId, voucherTitle: voucher.title, quantity: transferQty, senderName: sender?.name ?? 'Someone' };
      if (io) io.to(`user:${recipientUser.id}`).emit('voucher:transferred', payload);
      await notify({
        pushToken: recipientUser.push_token,
        userId: recipientUser.id,
        title: 'Voucher Received',
        body: `${sender?.name ?? 'Someone'} transferred ${transferQty > 1 ? `${transferQty}× ` : ''}"${voucher.title}" to you`,
        type: 'voucher_transferred',
        data: { screen: 'MyVouchers' },
      });
    }
  } catch { /* non-blocking */ }

  res.status(201).json({ ...transfer, quantity: transferQty });
}

/**
 * POST /vouchers/:id/owner-transfer
 * Allows the voucher owner (business promotion owner) to gift N vouchers directly
 * to a user by phone number, free of charge. The recipient's claimed_count is updated.
 */
export async function ownerTransferVoucher(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const { recipient_phone, quantity: rawQuantity } = req.body;
  const quantity = Math.max(1, Math.floor(Number(rawQuantity ?? 1)));

  // Fetch voucher with promotion ownership info
  const voucher = await prisma.voucher.findUnique({
    where: { id },
    include: { business_promotion: { select: { user_id: true } } },
  });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }
  if (voucher.status !== 'active') { res.status(400).json({ error: 'Voucher not active' }); return; }

  // Only the business promotion owner (or admin) may do this
  const isAdmin = req.user!.roles.includes('admin');
  const isOwner = voucher.business_promotion?.user_id === req.user!.userId;
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'Only the voucher owner can do a direct transfer' });
    return;
  }

  // Check expiry
  const expiry = getVoucherExpiry(voucher);
  if (expiry && expiry <= new Date()) {
    res.status(400).json({ error: 'Voucher expired' }); return;
  }

  // Check capacity
  if (voucher.max_claims && voucher.claimed_count + quantity > voucher.max_claims) {
    const remaining = Math.max(0, voucher.max_claims - voucher.claimed_count);
    res.status(400).json({ error: `Only ${remaining} voucher(s) remaining in the pool` }); return;
  }

  // Resolve recipient
  if (!recipient_phone) { res.status(400).json({ error: 'recipient_phone is required' }); return; }
  const variants = phoneVariants(recipient_phone);
  const recipient = await prisma.user.findFirst({
    where: { OR: variants.map((p) => ({ phone: p })) },
  });
  if (!recipient) { res.status(404).json({ error: 'Recipient not found. They must be registered on the platform.' }); return; }

  const sender = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  const normalizedRecipientPhone = normalizePhone(recipient_phone);

  let transfer;
  try {
    transfer = await prisma.$transaction(async (tx) => {
      // Create or increment the recipient's claim
      const existingClaim = await tx.voucherClaim.findUnique({
        where: { user_id_voucher_id: { user_id: recipient.id, voucher_id: id } },
      });

      if (existingClaim) {
        // Increment quantity on existing claim and reactivate if needed
        await tx.voucherClaim.update({
          where: { id: existingClaim.id },
          data: {
            quantity: { increment: quantity },
            status: existingClaim.status === 'transferred' || existingClaim.status === 'expired' ? 'active' : existingClaim.status,
          },
        });
      } else {
        await tx.voucherClaim.create({
          data: { voucher_id: id, user_id: recipient.id, status: 'active', quantity },
        });
      }

      // Increment the voucher's claimed_count by quantity
      await tx.voucher.update({
        where: { id },
        data: { claimed_count: { increment: quantity } },
      });

      return tx.voucherTransfer.create({
        data: {
          voucher_id: id,
          sender_id: req.user!.userId,
          recipient_id: recipient.id,
          sender_phone: sender!.phone ?? '',
          recipient_phone: normalizedRecipientPhone,
          quantity,
          is_owner_transfer: true,
        },
      });
    });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Concurrent conflict — please retry' });
      return;
    }
    throw err;
  }

  // Notify recipient
  try {
    const recipientUser = await prisma.user.findUnique({ where: { id: recipient.id }, select: { id: true, push_token: true } });
    if (recipientUser) {
      const io = getIO();
      const payload = { type: 'voucher:owner_transferred', transferId: transfer.id, voucherId: id, voucherTitle: voucher.title, quantity, senderName: sender?.name ?? 'Business' };
      if (io) io.to(`user:${recipientUser.id}`).emit('voucher:owner_transferred', payload);
      await notify({
        pushToken: recipientUser.push_token,
        userId: recipientUser.id,
        title: 'Vouchers Gifted!',
        body: `${sender?.name ?? 'A business'} gifted you ${quantity}× "${voucher.title}"`,
        type: 'voucher_owner_transferred',
        data: { screen: 'MyVouchers' },
      });
    }
  } catch { /* non-blocking */ }

  res.status(201).json({ ...transfer, quantity });
}

export async function getMyVouchers(req: AuthRequest, res: Response): Promise<void> {
  const promotionId = parseOptionalInt(req.query.promotionId);

  // Auto-expire overdue installment claims.
  await prisma.voucherClaim.updateMany({
    where: {
      user_id: req.user!.userId,
      status: 'active',
      installment_status: 'active',
      installment_deadline: { lt: new Date() },
      remaining_balance: { gt: 0 },
    },
    data: {
      status: 'expired',
      installment_status: 'expired',
    },
  });

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

  // Detect which voucher_ids were gifted by the business owner to this user
  const voucherIds = claims.map((c) => c.voucher_id);
  const ownerGiftedVoucherIds = new Set(
    voucherIds.length > 0
      ? (await prisma.voucherTransfer.findMany({
          where: { recipient_id: req.user!.userId, is_owner_transfer: true, voucher_id: { in: voucherIds } },
          select: { voucher_id: true },
        })).map((t) => t.voucher_id)
      : []
  );

  res.json(claims.map((c: any) => ({
    ...c,
    is_owner_gifted: ownerGiftedVoucherIds.has(c.voucher_id),
    voucher: decorateVoucher(c.voucher),
  })));
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

  const voucherWhere = promotionId
    ? { business_promotion_id: promotionId }
    : { business_promotion_id: { in: promotionIds } };

  const vouchers = await prisma.voucher.findMany({
    where: voucherWhere,
    orderBy: { created_at: 'desc' },
    include: { business_promotion: { select: { id: true, business_name: true, tier: true, status: true, payment_status: true } } },
  });

  const voucherIds = vouchers.map((v) => v.id);
  const claimGroups = voucherIds.length > 0
    ? await prisma.voucherClaim.groupBy({
        by: ['voucher_id', 'status'],
        where: { voucher_id: { in: voucherIds } },
        _count: { _all: true },
      })
    : [];

  // Build a map: voucherId -> { active, redeemed, expired, ... }
  const statusCountMap: Record<number, Record<string, number>> = {};
  for (const g of claimGroups) {
    if (!statusCountMap[g.voucher_id]) statusCountMap[g.voucher_id] = {};
    statusCountMap[g.voucher_id][g.status] = g._count._all;
  }

  res.json(vouchers.map((v) => {
    const counts = statusCountMap[v.id] ?? {};
    return {
      ...decorateVoucher(v),
      active_claims: counts['active'] ?? 0,
      redeemed_claims: counts['redeemed'] ?? 0,
      expired_claims: counts['expired'] ?? 0,
    };
  }));
}

/**
 * GET /vouchers/all-claims?status=active|redeemed|expired
 * Returns all claims across all vouchers owned by the authenticated user.
 * Includes voucher title for display.
 */
export async function getAllMyClaims(req: AuthRequest, res: Response): Promise<void> {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;

  const promotions = await prisma.businessPromotion.findMany({
    where: { user_id: req.user!.userId },
    select: { id: true },
  });
  const promotionIds = promotions.map((p) => p.id);

  const vouchers = await prisma.voucher.findMany({
    where: { business_promotion_id: { in: promotionIds } },
    select: { id: true, title: true },
  });
  const voucherIds = vouchers.map((v) => v.id);
  const voucherTitleMap: Record<number, string> = {};
  for (const v of vouchers) voucherTitleMap[v.id] = v.title;

  if (voucherIds.length === 0) {
    res.json([]);
    return;
  }

  const claims = await prisma.voucherClaim.findMany({
    where: {
      voucher_id: { in: voucherIds },
      ...(status ? { status } : {}),
    },
    include: {
      user: { select: { name: true, phone: true } },
    },
    orderBy: { claimed_at: 'desc' },
  });

  res.json(
    claims.map((c) => ({
      claim_id: c.id,
      voucher_id: c.voucher_id,
      voucher_title: voucherTitleMap[c.voucher_id] ?? '—',
      user_name: c.user.name,
      user_phone: c.user.phone,
      status: c.status,
      claimed_at: c.claimed_at,
      redeemed_at: c.redeemed_at,
    }))
  );
}

/**
 * GET /vouchers/:voucherId/claims
 * Returns all claims for a voucher (owner only).
 */
export async function getVoucherClaims(req: AuthRequest, res: Response): Promise<void> {
  const voucherId = paramInt(req.params.voucherId);

  const voucher = await prisma.voucher.findUnique({
    where: { id: voucherId },
    select: { id: true, owner_user_id: true, business_promotion_id: true },
  });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }

  // Owner check: voucher.owner_user_id OR user owns the business_promotion
  const isOwner = voucher.owner_user_id === req.user!.userId;
  let isPromoOwner = false;
  if (!isOwner && voucher.business_promotion_id) {
    const promo = await prisma.businessPromotion.findUnique({
      where: { id: voucher.business_promotion_id },
      select: { user_id: true },
    });
    isPromoOwner = promo?.user_id === req.user!.userId;
  }
  if (!isOwner && !isPromoOwner) { res.status(403).json({ error: 'Forbidden' }); return; }

  const claims = await prisma.voucherClaim.findMany({
    where: { voucher_id: voucherId },
    include: {
      user: { select: { name: true, phone: true } },
      installment_payments: { orderBy: { paid_at: 'desc' } },
    },
    orderBy: { claimed_at: 'desc' },
  });

  res.json(
    claims.map((c) => ({
      claim_id: c.id,
      user_name: c.user.name,
      user_phone: c.user.phone,
      status: c.status,
      claimed_at: c.claimed_at,
      redeemed_at: c.redeemed_at,
      installment_status: c.installment_status,
      remaining_balance: c.remaining_balance ? Number(c.remaining_balance) : null,
      paid_amount: c.paid_amount ? Number(c.paid_amount) : null,
      installment_deadline: c.installment_deadline,
      payments: c.installment_payments.map((p) => ({
        amount: Number(p.amount),
        paid_at: p.paid_at,
      })),
    }))
  );
}

export async function getMyTransfers(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const transfers = await prisma.voucherTransfer.findMany({
    where: { OR: [{ sender_id: userId }, { recipient_id: userId }] },
    orderBy: { transferred_at: 'desc' },
    include: {
      voucher: {
        select: {
          id: true,
          title: true,
          description: true,
          discount_type: true,
          discount_value: true,
          mrp: true,
          amount: true,
          voucher_image: true,
          voucher_images: true,
          company_logo: true,
          business_name: true,
        },
      },
      sender: { select: { id: true, name: true, profile_picture: true } },
      recipient: { select: { id: true, name: true, profile_picture: true } },
    },
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

export async function updateVoucher(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const existing = await prisma.voucher.findUnique({
    where: { id },
    select: { id: true, business_promotion: { select: { user_id: true } } },
  });
  if (!existing) { res.status(404).json({ error: 'Voucher not found' }); return; }
  const isOwner = existing.business_promotion?.user_id === req.user!.userId;
  const isAdmin = req.user!.roles.includes('admin');
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'Not your voucher' });
    return;
  }

  const b = req.body || {};
  const data: any = {};
  if (b.title !== undefined) data.title = b.title;
  if (b.subtitle !== undefined) data.subtitle = b.subtitle || null;
  if (b.description !== undefined) data.description = b.description || null;
  if (b.discount_type !== undefined) data.discount_type = b.discount_type;
  if (b.discount_value !== undefined) {
    const dv = parseFloat(b.discount_value);
    if (Number.isNaN(dv)) { res.status(400).json({ error: 'discount_value must be a number' }); return; }
    data.discount_value = dv;
  }
  if (b.code !== undefined) data.code = b.code || null;
  if (b.max_claims !== undefined) data.max_claims = b.max_claims ? parseInt(b.max_claims, 10) : null;
  if (b.min_vouchers_required !== undefined || b.min_claim !== undefined) {
    const mv = b.min_vouchers_required ?? b.min_claim;
    data.min_vouchers_required = mv ? parseInt(mv, 10) : null;
  }
  if (b.expires_at !== undefined) {
    const dt = b.expires_at ? new Date(b.expires_at) : null;
    data.expires_at = dt;
    data.expiry_date = dt;
  }
  if (b.original_price !== undefined || b.mrp !== undefined) {
    const raw = b.original_price ?? b.mrp;
    const n = raw !== null && raw !== '' ? Number(raw) : null;
    const v = n !== null && !Number.isNaN(n) && n >= 0 ? n : null;
    data.mrp = v;
    data.amount = v;
  }
  if (b.allows_installment !== undefined) {
    data.allows_installment = b.allows_installment === true || b.allows_installment === 'true';
  }
  if (b.upfront_amount !== undefined) {
    data.upfront_amount = b.upfront_amount ? parseFloat(b.upfront_amount) : null;
  }
  if (b.company_name !== undefined) data.company_name = b.company_name || null;
  if (b.phone_number !== undefined) data.phone_number = b.phone_number || null;
  if (b.address !== undefined) data.address = b.address || null;
  if (b.city !== undefined) {
    if (!b.city || typeof b.city !== 'string' || !b.city.trim()) {
      res.status(400).json({ error: 'City is required' });
      return;
    }
    data.city = b.city.trim();
  }
  if (b.pincode !== undefined) {
    if (!b.pincode || typeof b.pincode !== 'string' || !b.pincode.trim()) {
      res.status(400).json({ error: 'Pincode is required' });
      return;
    }
    data.pincode = b.pincode.trim();
  }
  if (b.terms !== undefined) data.terms = b.terms || null;
  // Reject local/non-http URIs (file://, content://, ph://, data:) — these are
  // device-local and would only render on the uploader's phone. The mobile
  // client must upload via /api/uploads/image first and submit the returned URL.
  const isWebUrl = (u: any) => typeof u === 'string' && /^https?:\/\//i.test(u);
  if (b.voucher_image !== undefined) {
    if (b.voucher_image && !isWebUrl(b.voucher_image)) {
      res.status(400).json({ error: 'voucher_image must be a public https URL. Upload the image first via /api/uploads/image.' });
      return;
    }
    data.voucher_image = b.voucher_image || null;
  }
  if (b.voucher_banner !== undefined) {
    if (b.voucher_banner && !isWebUrl(b.voucher_banner)) {
      res.status(400).json({ error: 'voucher_banner must be a public https URL. Upload the image first via /api/uploads/image.' });
      return;
    }
    data.voucher_banner = b.voucher_banner || null;
  }
  if (b.what_we_do !== undefined) data.what_we_do = b.what_we_do || null;
  if (b.website !== undefined) data.website = b.website || null;
  if (b.status !== undefined) {
    const allowed = ['active', 'inactive', 'draft'];
    if (!allowed.includes(b.status)) { res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` }); return; }
    data.status = b.status;
  }

  const updated = await prisma.voucher.update({
    where: { id },
    data,
    include: { business_promotion: { select: { id: true, business_name: true, tier: true, status: true, payment_status: true } } },
  });
  res.json(decorateVoucher(updated));
}

export async function deleteVoucher(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const existing = await prisma.voucher.findUnique({
    where: { id },
    select: { id: true, claimed_count: true, business_promotion: { select: { user_id: true } } },
  });
  if (!existing) { res.status(404).json({ error: 'Voucher not found' }); return; }
  const isOwner = existing.business_promotion?.user_id === req.user!.userId;
  const isAdmin = req.user!.roles.includes('admin');
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'Not your voucher' });
    return;
  }

  const claimCount = await prisma.voucherClaim.count({ where: { voucher_id: id } });
  if (claimCount > 0 && !isAdmin) {
    // Soft-delete: vouchers with claims cannot be hard-deleted. Mark inactive instead.
    await prisma.voucher.update({ where: { id }, data: { status: 'inactive' } });
    res.json({ success: true, soft_deleted: true, message: 'Voucher has claims; marked inactive instead of deleted.' });
    return;
  }

  await prisma.voucher.delete({ where: { id } });
  res.json({ success: true, deleted: true });
}

export async function redeemVoucher(req: AuthRequest, res: Response): Promise<void> {
  const voucherId = parseOptionalInt(req.body.voucher_id);
  if (!voucherId) {
    res.status(400).json({ error: 'voucher_id is required' });
    return;
  }

  // How many to redeem in this scan (default 1, max = remaining unredeemed)
  const redeemQty = Math.max(1, parseOptionalInt(req.body.redeem_quantity) ?? 1);

  const voucher = await prisma.voucher.findUnique({
    where: { id: voucherId },
    select: { id: true, status: true, expiry_date: true, expires_at: true },
  });
  if (!voucher) {
    res.status(404).json({ error: 'Voucher not found' }); return;
  }
  if (voucher.status !== 'active') {
    res.status(400).json({ error: 'Voucher not active' }); return;
  }
  const expiry = getVoucherExpiry(voucher);
  if (expiry && expiry <= new Date()) {
    res.status(400).json({ error: 'Voucher expired' }); return;
  }

  const claim = await prisma.voucherClaim.findFirst({
    where: { voucher_id: voucherId, user_id: req.user!.userId },
    orderBy: { claimed_at: 'desc' },
  });
  if (!claim) {
    res.status(404).json({ error: 'Voucher claim not found' }); return;
  }

  if (
    claim.installment_status === 'active' &&
    claim.installment_deadline &&
    claim.installment_deadline <= new Date() &&
    Number(claim.remaining_balance ?? 0) > 0
  ) {
    await prisma.voucherClaim.update({
      where: { id: claim.id },
      data: { status: 'expired', installment_status: 'expired' },
    });
    res.status(409).json({ error: 'Installment deadline missed. Voucher expired.' }); return;
  }

  const totalQty = claim.quantity ?? 1;
  const alreadyRedeemed = claim.redeemed_count ?? 0;
  const remaining = totalQty - alreadyRedeemed;

  if (claim.status === 'redeemed' || remaining <= 0) {
    res.status(200).json({
      id: claim.id,
      voucher_id: claim.voucher_id,
      claimed_at: claim.claimed_at,
      redeemed_at: claim.redeemed_at,
      status: 'redeemed',
      quantity: totalQty,
      redeemed_count: totalQty,
      remaining_uses: 0,
      idempotent: true,
    });
    return;
  }

  if (claim.status !== 'active') {
    res.status(409).json({ error: 'Only active voucher claims can be redeemed' }); return;
  }

  const toRedeem = Math.min(redeemQty, remaining);
  const newRedeemedCount = alreadyRedeemed + toRedeem;
  const fullyRedeemed = newRedeemedCount >= totalQty;
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.voucherClaim.update({
      where: { id: claim.id },
      data: {
        redeemed_count: newRedeemedCount,
        ...(fullyRedeemed ? { status: 'redeemed', redeemed_at: now } : {}),
      },
    });

    if (fullyRedeemed) {
      await tx.voucherRedemption.upsert({
        where: { voucher_id_used_by_id: { voucher_id: voucherId, used_by_id: req.user!.userId } },
        update: {},
        create: { voucher_id: voucherId, used_by_id: req.user!.userId, used_at: now },
      });
    }

    return next;
  });

  res.json({
    id: updated.id,
    voucher_id: updated.voucher_id,
    claimed_at: updated.claimed_at,
    redeemed_at: updated.redeemed_at,
    status: updated.status,
    quantity: totalQty,
    redeemed_count: newRedeemedCount,
    remaining_uses: totalQty - newRedeemedCount,
    just_redeemed: toRedeem,
  });
}

/**
 * POST /vouchers/redeem-by-qr
 * Called by the business owner's VoucherScanner screen.
 * Body: { voucher_id: number, claim_id: number }
 * Validates the claim belongs to the voucher and that the caller is the voucher owner,
 * then marks the claim as redeemed.
 */
export async function redeemVoucherByQr(req: AuthRequest, res: Response): Promise<void> {
  const voucherId = parseOptionalInt(req.body.voucher_id);
  const claimId = parseOptionalInt(req.body.claim_id);
  const redeemQty = Math.max(1, parseOptionalInt(req.body.redeem_quantity) ?? 1);

  if (!voucherId || !claimId) {
    res.status(400).json({ error: 'voucher_id and claim_id are required' }); return;
  }

  const voucher = await prisma.voucher.findUnique({
    where: { id: voucherId },
    select: { id: true, title: true, status: true, owner_user_id: true, expiry_date: true, expires_at: true, business_promotion: { select: { user_id: true } } },
  });
  if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }

  const isOwner = voucher.business_promotion?.user_id === req.user!.userId || req.user!.roles.includes('admin');
  if (!isOwner) {
    res.status(403).json({ error: 'Only the voucher owner can scan and redeem vouchers' }); return;
  }

  const claim = await prisma.voucherClaim.findUnique({
    where: { id: claimId },
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  if (!claim || claim.voucher_id !== voucherId) {
    res.status(404).json({ error: 'QR code not valid for this voucher' }); return;
  }

  const expiry = getVoucherExpiry(voucher);
  if (expiry && expiry <= new Date()) {
    res.status(400).json({ error: 'Voucher has expired' }); return;
  }

  const totalQty = claim.quantity ?? 1;
  const alreadyRedeemed = claim.redeemed_count ?? 0;
  const remaining = totalQty - alreadyRedeemed;

  if (claim.status === 'redeemed' || remaining <= 0) {
    res.status(200).json({
      already_redeemed: true,
      id: claim.id,
      voucher_id: claim.voucher_id,
      redeemed_at: claim.redeemed_at,
      quantity: totalQty,
      redeemed_count: totalQty,
      remaining_uses: 0,
      user: claim.user,
    });
    return;
  }

  if (claim.status !== 'active') {
    res.status(409).json({ error: `Claim is ${claim.status} — cannot redeem` }); return;
  }

  const toRedeem = Math.min(redeemQty, remaining);
  const newRedeemedCount = alreadyRedeemed + toRedeem;
  const fullyRedeemed = newRedeemedCount >= totalQty;
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.voucherClaim.update({
      where: { id: claimId },
      data: {
        redeemed_count: newRedeemedCount,
        ...(fullyRedeemed ? { status: 'redeemed', redeemed_at: now } : {}),
      },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });
    if (fullyRedeemed) {
      await tx.voucherRedemption.upsert({
        where: { voucher_id_used_by_id: { voucher_id: voucherId, used_by_id: claim.user_id } },
        update: {},
        create: { voucher_id: voucherId, used_by_id: claim.user_id, used_at: now },
      });
    }
    return next;
  });

  res.json({
    already_redeemed: false,
    id: updated.id,
    voucher_id: updated.voucher_id,
    redeemed_at: updated.redeemed_at,
    quantity: totalQty,
    redeemed_count: newRedeemedCount,
    remaining_uses: totalQty - newRedeemedCount,
    just_redeemed: toRedeem,
    user: updated.user,
  });
}

/**
 * POST /vouchers/:id/payment-intent
 * Creates a Razorpay order for the voucher's discounted price × quantity.
 * Returns the order details required by the mobile checkout SDK/WebView.
 */
export async function createVoucherPaymentIntent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    // Optional promo code from body — validates against voucher.code
    const { promo_code, payment_mode } = req.body;

    // quantity: how many units of this voucher the user wants to buy (min 1)
    const quantity = Math.max(1, Math.floor(Number(req.body.quantity ?? 1)));

    const voucher = await prisma.voucher.findUnique({ where: { id } });
    if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }
    if (voucher.status !== 'active') { res.status(400).json({ error: 'Voucher not active' }); return; }

    const expiry = getVoucherExpiry(voucher);
    if (expiry && expiry <= new Date()) {
      res.status(400).json({ error: 'Voucher expired' }); return;
    }

    // Check that enough units remain
    if (voucher.max_claims && voucher.claimed_count + quantity > voucher.max_claims) {
      const remaining = Math.max(0, voucher.max_claims - voucher.claimed_count);
      res.status(400).json({ error: `Only ${remaining} voucher(s) remaining` }); return;
    }

    const existing = await prisma.voucherClaim.findFirst({
      where: { voucher_id: id, user_id: req.user!.userId },
      select: { id: true },
    });
    if (existing) { res.status(409).json({ error: 'Already claimed' }); return; }

    // Validate promo code — unlocks discounted_price
    const promoApplied = promo_code && voucher.code && promo_code.trim().toUpperCase() === voucher.code.trim().toUpperCase();
    if (promo_code && !promoApplied) {
      res.status(400).json({ error: 'Invalid promo code' }); return;
    }

    const decorated = decorateVoucher(voucher)!;
    // Per-unit price (promo applied or not)
    const pricePerUnit = promoApplied
      ? Number(decorated.discounted_price || 0)
      : Number(decorated.original_price || 0);

    // Total applicable price for all units
    const applicablePrice = pricePerUnit * quantity;

    // For installment vouchers, charge upfront only when payment_mode='upfront'; otherwise charge full applicable price
    const isUpfrontPayment = payment_mode === 'upfront' && voucher.allows_installment && voucher.upfront_amount;
    const upfrontPerUnit = isUpfrontPayment ? Number(voucher.upfront_amount) : pricePerUnit;
    const chargeNow = upfrontPerUnit * quantity;

    if (chargeNow <= 0) {
      res.status(400).json({ error: 'Voucher is free \u2014 no payment required' });
      return;
    }

    const amountPaise = Math.round(chargeNow * 100);
    const order = await createRazorpayOrder({
      amountPaise,
      currency: 'INR',
      receipt: `voucher_${id}_user_${req.user!.userId}`,
      notes: {
        voucher_id: String(id),
        user_id: String(req.user!.userId),
        quantity: String(quantity),
        kind: voucher.allows_installment ? 'voucher_installment_upfront' : 'voucher_claim',
        promo_applied: String(promoApplied),
        applicable_price: String(applicablePrice),
      },
    });

    res.json({
      key: getRazorpayPublicKey(),
      order_id: order.id,
      amount: amountPaise,
      currency: 'INR',
      voucher_id: id,
      voucher_title: voucher.title,
      quantity,
      price_per_unit: pricePerUnit,
      promo_applied: promoApplied,
      applicable_price: applicablePrice,
      allows_installment: voucher.allows_installment,
      upfront_amount: voucher.allows_installment ? upfrontPerUnit * quantity : null,
      remaining_after_upfront: voucher.allows_installment
        ? Math.max(0, applicablePrice - upfrontPerUnit * quantity)
        : 0,
    });
  } catch (err) {
    console.error('[VOUCHER-PAYMENT] Failed to create intent', err);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
}

/**
 * POST /vouchers/:id/verify-payment
 * Verifies the Razorpay signature, then creates the voucher claim atomically.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
export async function verifyVoucherPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).json({ error: 'Payment verification fields are required' });
      return;
    }

    const isValid = verifyRazorpaySignature({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });
    if (!isValid) {
      res.status(400).json({ error: 'Invalid payment signature' });
      return;
    }

    const voucher = await prisma.voucher.findUnique({
      where: { id },
      select: { id: true, title: true, status: true, max_claims: true, claimed_count: true, owner_user_id: true, expiry_date: true, expires_at: true },
    });
    if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }
    if (voucher.status !== 'active') { res.status(400).json({ error: 'Voucher not active' }); return; }

    const expiry = getVoucherExpiry(voucher);
    if (expiry && expiry <= new Date()) {
      res.status(400).json({ error: 'Voucher expired' }); return;
    }

    // quantity: how many units were purchased (must match what was ordered)
    const quantity = Math.max(1, Math.floor(Number(req.body.quantity ?? 1)));

    if (voucher.max_claims && voucher.claimed_count + quantity > voucher.max_claims) {
      const remaining = Math.max(0, voucher.max_claims - voucher.claimed_count);
      res.status(400).json({ error: `Only ${remaining} voucher(s) remaining` }); return;
    }

    const existing = await prisma.voucherClaim.findFirst({
      where: { voucher_id: id, user_id: req.user!.userId },
      select: { id: true },
    });
    if (existing) { res.status(409).json({ error: 'Already claimed' }); return; }

    // Installment plan details passed from payment body
    const { promo_applied, allows_installment: frontendAllowsInstallment } = req.body;
    const voucher2Raw = await prisma.voucher.findUnique({
      where: { id },
      select: {
        allows_installment: true,
        upfront_amount: true,
        mrp: true,
        amount: true,
        discount_value: true,
        discount_type: true,
      },
    });
    const voucher2 = decorateVoucher(voucher2Raw);

    // Recalculate total price from DB — never trust client-supplied amount
    const pricePerUnit = promo_applied
      ? Number(voucher2?.discounted_price || voucher2?.original_price || 0)
      : Number(voucher2?.original_price || 0);
    const totalPrice = pricePerUnit * quantity;

    // Use frontend override if provided, otherwise use DB value
    const shouldEnableInstallment = frontendAllowsInstallment !== undefined ? frontendAllowsInstallment : voucher2?.allows_installment;
    const isInstallment = shouldEnableInstallment && voucher2?.upfront_amount;
    const upfrontTotal = isInstallment ? Number(voucher2!.upfront_amount) * quantity : 0;
    const remainingBalance = isInstallment
      ? Math.max(0, totalPrice - upfrontTotal)
      : 0;
    const paidAmount = isInstallment ? upfrontTotal : totalPrice;
    const installmentDeadline = isInstallment ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;

    let claim;
    try {
      [claim] = await prisma.$transaction([
        prisma.voucherClaim.create({
          data: {
            voucher_id: id,
            user_id: req.user!.userId,
            status: 'active',
            quantity,
            ...(isInstallment ? {
              remaining_balance: remainingBalance,
              paid_amount: paidAmount,
              installment_deadline: installmentDeadline,
              installment_status: remainingBalance <= 0 ? 'completed' : 'active',
            } : {}),
          },
        }),
        prisma.voucher.update({
          where: { id },
          data: { claimed_count: { increment: quantity } },
        }),
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
          const payload = { type: 'voucher:claimed', voucherId: id, voucherTitle: voucher.title, claimerName: claimer?.name ?? 'Someone', quantity };
          if (io) io.to(`user:${owner.id}`).emit('voucher:claimed', payload);
          const ownerBody = isInstallment
            ? `${claimer?.name ?? 'Someone'} claimed ${quantity}× "${voucher.title}" with installment plan. Paid upfront ₹${paidAmount.toLocaleString()}, ₹${remainingBalance.toLocaleString()} remaining (due in 30 days).`
            : `${claimer?.name ?? 'Someone'} claimed ${quantity}× "${voucher.title}" and paid ₹${paidAmount.toLocaleString()}.`;
          await notify({
            pushToken: owner.push_token,
            userId: owner.id,
            title: 'Voucher Claimed',
            body: ownerBody,
            type: 'voucher_claimed',
            data: { screen: 'MyCreatedVouchers', voucherId: id, claimId: claim.id },
          });
        }
      }

      // Customer confirmation
      const customerBody = isInstallment
        ? `You claimed ${quantity}× "${voucher.title}". Paid ₹${paidAmount.toLocaleString()} now, ₹${remainingBalance.toLocaleString()} due within 30 days.`
        : `You claimed ${quantity}× "${voucher.title}" for ₹${paidAmount.toLocaleString()}.`;
      const customer = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { push_token: true } });
      await notify({
        pushToken: customer?.push_token,
        userId: req.user!.userId,
        title: isInstallment ? 'Installment plan started' : 'Voucher claimed',
        body: customerBody,
        type: isInstallment ? 'installment_started' : 'voucher_purchased',
        data: { screen: 'MyVouchers', voucherId: id, claimId: claim.id },
      });
    } catch { /* non-blocking */ }

    res.status(201).json({
      id: claim.id,
      voucher_id: claim.voucher_id,
      claimed_at: claim.claimed_at,
      status: claim.status,
      quantity,
      payment_id: razorpay_payment_id,
      installment: isInstallment ? {
        remaining_balance: remainingBalance,
        paid_amount: paidAmount,
        installment_deadline: installmentDeadline,
        installment_status: remainingBalance <= 0 ? 'completed' : 'active',
      } : null,
    });
  } catch (err) {
    console.error('[VOUCHER-VERIFY] Failed', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
}
