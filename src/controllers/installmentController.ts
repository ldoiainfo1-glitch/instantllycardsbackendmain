import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt } from '../utils/params';
import { createRazorpayOrder, getRazorpayPublicKey, verifyRazorpaySignature } from '../services/razorpayService';
import { notify } from '../utils/notify';

/**
 * POST /vouchers/:claimId/installment/pay
 * Creates a Razorpay order for a partial installment payment.
 * Body: { amount: number }   — the amount the user wants to pay now (in ₹)
 */
export async function createInstallmentPaymentIntent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const claimId = paramInt(req.params.claimId);
    const amount = parseFloat(req.body.amount);

    if (!amount || isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }

    const claim = await prisma.voucherClaim.findUnique({
      where: { id: claimId },
      include: { voucher: { select: { id: true, title: true } } },
    });

    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (claim.user_id !== req.user!.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (claim.installment_status !== 'active') {
      res.status(400).json({ error: 'Installment plan is not active' });
      return;
    }

    const remaining = Number(claim.remaining_balance ?? 0);
    if (remaining <= 0) {
      res.status(400).json({ error: 'No remaining balance' });
      return;
    }

    // Check deadline
    if (claim.installment_deadline && new Date() > claim.installment_deadline) {
      // Auto-expire
      await prisma.voucherClaim.update({
        where: { id: claimId },
        data: { installment_status: 'expired', status: 'expired' },
      });
      res.status(400).json({ error: 'Installment deadline has passed. Voucher expired.' });
      return;
    }

    const payAmount = Math.min(amount, remaining);
    const amountPaise = Math.round(payAmount * 100);

    const order = await createRazorpayOrder({
      amountPaise,
      currency: 'INR',
      receipt: `inst_${claimId}_${Date.now()}`,
      notes: {
        claim_id: String(claimId),
        user_id: String(req.user!.userId),
        kind: 'installment',
      },
    });

    res.json({
      key: getRazorpayPublicKey(),
      order_id: order.id,
      amount: amountPaise,
      currency: 'INR',
      claim_id: claimId,
      voucher_title: claim.voucher.title,
    });
  } catch (err) {
    console.error('[INSTALLMENT] Failed to create payment intent', err);
    res.status(500).json({ error: 'Failed to create installment payment intent' });
  }
}

/**
 * POST /vouchers/:claimId/installment/verify
 * Verifies Razorpay signature and records the installment payment.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount }
 */
export async function verifyInstallmentPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const claimId = paramInt(req.params.claimId);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

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

    const claim = await prisma.voucherClaim.findUnique({ where: { id: claimId } });
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (claim.user_id !== req.user!.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (claim.installment_status !== 'active') {
      res.status(400).json({ error: 'Installment plan is not active' });
      return;
    }

    const paidAmount = parseFloat(amount);
    const currentRemaining = Number(claim.remaining_balance ?? 0);
    const currentPaid = Number(claim.paid_amount ?? 0);
    const newRemaining = Math.max(0, currentRemaining - paidAmount);
    const newPaid = currentPaid + paidAmount;
    const isComplete = newRemaining <= 0;

    await prisma.$transaction([
      prisma.installmentPayment.create({
        data: {
          claim_id: claimId,
          amount: paidAmount,
          razorpay_order_id,
          razorpay_payment_id,
        },
      }),
      prisma.voucherClaim.update({
        where: { id: claimId },
        data: {
          remaining_balance: newRemaining,
          paid_amount: newPaid,
          installment_status: isComplete ? 'completed' : 'active',
        },
      }),
    ]);

    // Best-effort notifications for both customer and voucher owner.
    try {
      const ctx = await prisma.voucherClaim.findUnique({
        where: { id: claimId },
        include: {
          user: { select: { id: true, name: true, push_token: true } },
          voucher: {
            select: {
              id: true,
              title: true,
              owner_user_id: true,
              business_promotion_id: true,
            },
          },
        },
      });
      if (ctx) {
        // Customer
        const customerTitle = isComplete ? 'Voucher fully paid' : 'Installment received';
        const customerBody = isComplete
          ? `You have completed payment for "${ctx.voucher.title}". Total paid ₹${newPaid.toLocaleString()}.`
          : `Payment of ₹${paidAmount.toLocaleString()} received for "${ctx.voucher.title}". ₹${newRemaining.toLocaleString()} remaining.`;
        await notify({
          pushToken: ctx.user.push_token,
          userId: ctx.user.id,
          title: customerTitle,
          body: customerBody,
          type: isComplete ? 'installment_completed' : 'installment_paid',
          data: { screen: 'MyVouchers', claimId, voucherId: ctx.voucher.id },
        });

        // Owner (voucher.owner_user_id ?? promotion owner)
        let ownerId: number | null = ctx.voucher.owner_user_id ?? null;
        if (!ownerId && ctx.voucher.business_promotion_id) {
          const promo = await prisma.businessPromotion.findUnique({
            where: { id: ctx.voucher.business_promotion_id },
            select: { user_id: true },
          });
          ownerId = promo?.user_id ?? null;
        }
        if (ownerId && ownerId !== ctx.user.id) {
          const owner = await prisma.user.findUnique({
            where: { id: ownerId },
            select: { push_token: true },
          });
          const ownerTitle = isComplete ? 'Installment completed' : 'Installment payment received';
          const ownerBody = isComplete
            ? `${ctx.user.name ?? 'A customer'} fully paid for "${ctx.voucher.title}" (₹${newPaid.toLocaleString()}).`
            : `${ctx.user.name ?? 'A customer'} paid ₹${paidAmount.toLocaleString()} for "${ctx.voucher.title}". ₹${newRemaining.toLocaleString()} remaining.`;
          await notify({
            pushToken: owner?.push_token,
            userId: ownerId,
            title: ownerTitle,
            body: ownerBody,
            type: 'installment_payment_received',
            data: { screen: 'MyCreatedVouchers', claimId, voucherId: ctx.voucher.id },
          });
        }
      }
    } catch (e) {
      console.error('[INSTALLMENT] Notification dispatch failed', e);
    }

    res.json({
      success: true,
      remaining_balance: newRemaining,
      paid_amount: newPaid,
      installment_status: isComplete ? 'completed' : 'active',
    });
  } catch (err) {
    console.error('[INSTALLMENT] Failed to verify payment', err);
    res.status(500).json({ error: 'Failed to verify installment payment' });
  }
}

/**
 * GET /vouchers/:claimId/installment
 * Returns installment details: remaining balance, deadline, payment history.
 */
export async function getInstallmentStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const claimId = paramInt(req.params.claimId);

    const claim = await prisma.voucherClaim.findUnique({
      where: { id: claimId },
      include: {
        installment_payments: { orderBy: { paid_at: 'desc' } },
        voucher: { select: { id: true, title: true } },
      },
    });

    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (claim.user_id !== req.user!.userId) { res.status(403).json({ error: 'Forbidden' }); return; }

    res.json({
      claim_id: claim.id,
      voucher_id: claim.voucher_id,
      voucher_title: claim.voucher.title,
      remaining_balance: Number(claim.remaining_balance ?? 0),
      paid_amount: Number(claim.paid_amount ?? 0),
      installment_deadline: claim.installment_deadline,
      installment_status: claim.installment_status,
      payments: claim.installment_payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paid_at: p.paid_at,
        razorpay_payment_id: p.razorpay_payment_id,
      })),
    });
  } catch (err) {
    console.error('[INSTALLMENT] Failed to get status', err);
    res.status(500).json({ error: 'Failed to get installment status' });
  }
}

/**
 * GET /vouchers/my-installments
 * Returns all active installment claims for the authenticated user.
 */
export async function getMyInstallments(req: AuthRequest, res: Response): Promise<void> {
  try {
    const now = new Date();

    // Auto-expire overdue installments before returning
    await prisma.voucherClaim.updateMany({
      where: {
        user_id: req.user!.userId,
        installment_status: 'active',
        installment_deadline: { lt: now },
        remaining_balance: { gt: 0 },
      },
      data: { installment_status: 'expired', status: 'expired' },
    });

    const claims = await prisma.voucherClaim.findMany({
      where: {
        user_id: req.user!.userId,
        installment_status: { not: null },
      },
      include: {
        voucher: { select: { id: true, title: true, subtitle: true } },
        installment_payments: { orderBy: { paid_at: 'desc' }, take: 5 },
      },
      orderBy: { claimed_at: 'desc' },
    });

    res.json(
      claims.map((c) => ({
        claim_id: c.id,
        voucher_id: c.voucher_id,
        voucher_title: c.voucher.title,
        voucher_subtitle: c.voucher.subtitle,
        remaining_balance: Number(c.remaining_balance ?? 0),
        paid_amount: Number(c.paid_amount ?? 0),
        installment_deadline: c.installment_deadline,
        installment_status: c.installment_status,
        recent_payments: c.installment_payments.map((p) => ({
          amount: Number(p.amount),
          paid_at: p.paid_at,
        })),
      }))
    );
  } catch (err) {
    console.error('[INSTALLMENT] Failed to get my installments', err);
    res.status(500).json({ error: 'Failed to get installments' });
  }
}

/**
 * GET /vouchers/:voucherId/installment-ledger
 * Returns all installment claims for a voucher (owner only).
 */
export async function getVoucherInstallmentLedger(req: AuthRequest, res: Response): Promise<void> {
  try {
    const voucherId = paramInt(req.params.voucherId);

    const voucher = await prisma.voucher.findUnique({
      where: { id: voucherId },
      select: { id: true, owner_user_id: true, business_promotion_id: true },
    });

    if (!voucher) { res.status(404).json({ error: 'Voucher not found' }); return; }
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
      where: { voucher_id: voucherId, installment_status: { not: null } },
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
        remaining_balance: Number(c.remaining_balance ?? 0),
        paid_amount: Number(c.paid_amount ?? 0),
        installment_deadline: c.installment_deadline,
        installment_status: c.installment_status,
        payments: c.installment_payments.map((p) => ({
          amount: Number(p.amount),
          paid_at: p.paid_at,
        })),
      }))
    );
  } catch (err) {
    console.error('[INSTALLMENT] Failed to get installment ledger', err);
    res.status(500).json({ error: 'Failed to get installment ledger' });
  }
}
