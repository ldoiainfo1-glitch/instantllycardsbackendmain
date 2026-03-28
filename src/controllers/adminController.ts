import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';

export async function getDashboardCounts(_req: AuthRequest, res: Response): Promise<void> {
  const [users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads] =
    await Promise.all([
      prisma.user.count(),
      prisma.businessCard.count(),
      prisma.businessPromotion.count(),
      prisma.voucher.count(),
      prisma.category.count(),
      prisma.review.count(),
      prisma.feedback.count(),
      prisma.ad.count(),
    ]);

  res.json({ users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads });
}

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
