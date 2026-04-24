import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';

export async function listBusinessLeads(req: AuthRequest, res: Response): Promise<void> {
  const businessId = paramInt(req.params.businessId);
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const status = req.query.status as string | undefined;
  const promotionId = queryInt(req.query.promotion_id, 0) || undefined;

  const card = await prisma.businessCard.findUnique({ where: { id: businessId } });
  if (!card) { res.status(404).json({ error: 'Business not found' }); return; }
  if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const scope: any[] = [{ business_id: businessId }];
  if (promotionId) scope.push({ business_promotion_id: promotionId });
  const where: any = { OR: scope };
  if (status) where.status = status;

  const leads = await prisma.lead.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
  });
  res.json({ data: leads, page, limit });
}

export async function listPromotionLeads(req: AuthRequest, res: Response): Promise<void> {
  const promotionId = paramInt(req.params.promotionId);
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const status = req.query.status as string | undefined;

  const promotion = await prisma.businessPromotion.findUnique({ where: { id: promotionId } });
  if (!promotion) { res.status(404).json({ error: 'Promotion not found' }); return; }
  if (promotion.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const scope: any[] = [{ business_promotion_id: promotionId }];
  if (promotion.business_card_id) scope.push({ business_id: promotion.business_card_id });
  const where: any = { OR: scope };
  if (status) where.status = status;

  const leads = await prisma.lead.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
  });
  res.json({ data: leads, page, limit });
}

export async function createLead(req: AuthRequest, res: Response): Promise<void> {
  const { business_id, business_promotion_id, customer_name, customer_phone, customer_email, message } = req.body;

  let cardId: number | null = business_id ? Number(business_id) : null;
  let promoId: number | null = business_promotion_id ? Number(business_promotion_id) : null;

  if (!cardId && !promoId) {
    res.status(400).json({ error: 'business_id or business_promotion_id required' }); return;
  }

  if (promoId && !cardId) {
    const promo = await prisma.businessPromotion.findUnique({ where: { id: promoId } });
    if (!promo) { res.status(404).json({ error: 'Promotion not found' }); return; }
    if (promo.business_card_id) cardId = promo.business_card_id;
  }

  const lead = await prisma.lead.create({
    data: {
      business_id: cardId ?? undefined,
      business_promotion_id: promoId ?? undefined,
      customer_name,
      customer_phone,
      customer_email,
      message,
    },
  });
  res.status(201).json(lead);
}

export async function updateLeadStatus(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const { status } = req.body;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      business: { select: { user_id: true } },
      business_promotion: { select: { user_id: true } },
    },
  });
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
  const ownerId = lead.business?.user_id ?? lead.business_promotion?.user_id;
  if (ownerId !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const updated = await prisma.lead.update({ where: { id }, data: { status } });
  res.json(updated);
}
