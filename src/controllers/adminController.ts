import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';

export async function getDashboardCounts(_req: AuthRequest, res: Response): Promise<void> {
  const [users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads, adCampaigns, bookings, events] =
    await Promise.all([
      prisma.user.count(),
      prisma.businessCard.count(),
      prisma.businessPromotion.count(),
      prisma.voucher.count(),
      prisma.category.count(),
      prisma.review.count(),
      prisma.feedback.count(),
      prisma.ad.count(),
      prisma.adCampaign.count(),
      prisma.booking.count(),
      prisma.event.count(),
    ]);

  res.json({ users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads, adCampaigns, bookings, events });
}

// ─── Promotions ──────────────────────────────────────────────────────────────

export async function getPendingPromotions(req: AuthRequest, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);

  const promotions = await prisma.businessPromotion.findMany({
    where: { status: 'pending' },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  res.json({ data: promotions, page, limit });
}

export async function approvePromotion(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const promo = await prisma.businessPromotion.update({ where: { id }, data: { status: 'active' } });
  res.json(promo);
}

export async function rejectPromotion(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const { reason } = req.body;
  const promo = await prisma.businessPromotion.update({ where: { id }, data: { status: 'rejected' } });
  res.json({ ...promo, rejection_reason: reason });
}

// ─── Ad campaign management ─────────────────────────────────────────────────

export async function listAdCampaigns(req: AuthRequest, res: Response): Promise<void> {
  const status = req.query.approval_status as string | undefined;
  const where: any = {};
  if (status && status !== 'all') where.approval_status = status;

  const campaigns = await prisma.adCampaign.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      user: { select: { id: true, name: true, phone: true } },
      business: { select: { id: true, company_name: true, logo_url: true } },
    },
    take: 200,
  });
  res.json(campaigns);
}

export async function approveAdCampaign(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const campaign = await prisma.adCampaign.update({
    where: { id },
    data: { approval_status: 'approved', status: 'active' },
  });
  res.json(campaign);
}

export async function rejectAdCampaign(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const campaign = await prisma.adCampaign.update({
    where: { id },
    data: { approval_status: 'rejected', status: 'paused' },
  });
  res.json(campaign);
}

// ─── Listing endpoints ──────────────────────────────────────────────────────

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 50);

  const users = await prisma.user.findMany({
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    select: {
      id: true, name: true, phone: true, email: true,
      profile_picture: true, created_at: true,
      user_roles: true,
    },
  });
  res.json({ data: users, page, limit });
}

export async function listBusinesses(req: AuthRequest, res: Response): Promise<void> {
  const status = req.query.approval_status as string | undefined;
  const where: any = {};
  if (status && status !== 'all') where.approval_status = status;

  const cards = await prisma.businessCard.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  res.json(cards);
}

export async function approveBusinessCard(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const card = await prisma.businessCard.update({
    where: { id },
    data: { approval_status: 'approved' },
  });
  res.json(card);
}

export async function rejectBusinessCard(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const card = await prisma.businessCard.update({
    where: { id },
    data: { approval_status: 'rejected' },
  });
  res.json(card);
}

export async function listEvents(_req: AuthRequest, res: Response): Promise<void> {
  const events = await prisma.event.findMany({
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  res.json(events);
}

export async function listVouchers(_req: AuthRequest, res: Response): Promise<void> {
  const vouchers = await prisma.voucher.findMany({
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  res.json(vouchers);
}

export async function listReviews(_req: AuthRequest, res: Response): Promise<void> {
  const reviews = await prisma.review.findMany({
    orderBy: { created_at: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true } } },
  });
  res.json(reviews);
}
