import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt } from '../utils/params';

export async function listAds(_req: Request, res: Response): Promise<void> {
  const ads = await prisma.ad.findMany({
    where: { status: 'active' },
    orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
    include: { business: { select: { id: true, company_name: true, logo_url: true } } },
    take: 50,
  });
  res.json(ads);
}

export async function trackImpression(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  await prisma.$transaction([
    prisma.adImpression.create({ data: { ad_id: id, user_id: req.user?.userId } }),
    prisma.ad.update({ where: { id }, data: { impressions: { increment: 1 } } }),
  ]);
  res.json({ ok: true });
}

export async function trackClick(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  await prisma.$transaction([
    prisma.adClick.create({ data: { ad_id: id, user_id: req.user?.userId } }),
    prisma.ad.update({ where: { id }, data: { clicks: { increment: 1 } } }),
  ]);
  res.json({ ok: true });
}

export async function getMyAds(req: AuthRequest, res: Response): Promise<void> {
  const cards = await prisma.businessCard.findMany({
    where: { user_id: req.user!.userId },
    select: { id: true },
  });
  const cardIds = cards.map((c) => c.id);
  const ads = await prisma.ad.findMany({
    where: { business_id: { in: cardIds } },
    include: { business: { select: { id: true, company_name: true } } },
    orderBy: { created_at: 'desc' },
  });
  res.json(ads);
}
