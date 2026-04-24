import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt } from '../utils/params';
import { getIO } from '../services/socketService';
import { sendExpoPushNotification } from '../utils/push';

export async function getCardReviews(req: Request, res: Response): Promise<void> {
  const cardId = paramInt(req.params.cardId);
  const reviews = await prisma.review.findMany({
    where: { business_id: cardId },
    include: { user: { select: { id: true, name: true, profile_picture: true } } },
    orderBy: { created_at: 'desc' },
  });
  res.json(reviews);
}

export async function getPromotionReviews(req: Request, res: Response): Promise<void> {
  const promotionId = paramInt(req.params.promotionId);
  const promo = await prisma.businessPromotion.findUnique({
    where: { id: promotionId },
    select: { id: true, business_card_id: true },
  });
  if (!promo) { res.status(404).json({ error: 'Promotion not found' }); return; }

  const scope: any[] = [{ business_promotion_id: promotionId }];
  if (promo.business_card_id) scope.push({ business_id: promo.business_card_id });

  const reviews = await prisma.review.findMany({
    where: { OR: scope },
    include: { user: { select: { id: true, name: true, profile_picture: true } } },
    orderBy: { created_at: 'desc' },
  });
  res.json(reviews);
}

export async function createReview(req: AuthRequest, res: Response): Promise<void> {
  const { business_id, business_promotion_id, rating, comment, photo_url } = req.body;

  let resolvedBusinessId: number | null = business_id ? parseInt(business_id, 10) : null;
  let resolvedPromotionId: number | null = business_promotion_id ? parseInt(business_promotion_id, 10) : null;

  if (!resolvedBusinessId && !resolvedPromotionId) {
    res.status(400).json({ error: 'business_id or business_promotion_id is required' });
    return;
  }

  if (resolvedPromotionId && !resolvedBusinessId) {
    const promo = await prisma.businessPromotion.findUnique({
      where: { id: resolvedPromotionId },
      select: { business_card_id: true },
    });
    if (promo?.business_card_id) resolvedBusinessId = promo.business_card_id;
  }

  const dedupeScope: any[] = [];
  if (resolvedBusinessId) dedupeScope.push({ business_id: resolvedBusinessId });
  if (resolvedPromotionId) dedupeScope.push({ business_promotion_id: resolvedPromotionId });
  const existing = await prisma.review.findFirst({
    where: { user_id: req.user!.userId, OR: dedupeScope },
  });
  if (existing) { res.status(409).json({ error: 'Already reviewed' }); return; }

  const review = await prisma.review.create({
    data: {
      business_id: resolvedBusinessId,
      business_promotion_id: resolvedPromotionId,
      user_id: req.user!.userId,
      rating: parseInt(rating),
      comment: comment || null,
      photo_url: photo_url || null,
    },
  });

  // Notify business card owner about the new review
  try {
    const card = await prisma.businessCard.findUnique({ where: { id: parseInt(business_id) }, select: { user_id: true, company_name: true, full_name: true } });
    if (card) {
      const owner = await prisma.user.findUnique({ where: { id: card.user_id }, select: { id: true, push_token: true } });
      const reviewer = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } });
      if (owner && owner.id !== req.user!.userId) {
        const io = getIO();
        const payload = { type: 'review:created', reviewId: review.id, businessId: parseInt(business_id), rating: parseInt(rating), reviewerName: reviewer?.name ?? 'Someone' };
        if (io) io.to(`user:${owner.id}`).emit('review:created', payload);
        if (owner.push_token) {
          sendExpoPushNotification(owner.push_token, 'New Review', `${reviewer?.name ?? 'Someone'} left a ${rating}-star review on ${card.company_name || card.full_name}`, { screen: 'Reviews' });
        }
      }
    }
  } catch { /* non-blocking */ }

  res.status(201).json(review);
}

export async function createFeedback(req: AuthRequest, res: Response): Promise<void> {
  const { name, phone, subject, message, rating } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  const feedback = await prisma.feedback.create({
    data: {
      user_id: req.user!.userId,
      name: name || user?.name || 'Unknown',
      phone: phone || user?.phone || '',
      subject: subject || 'General',
      message,
      rating: rating ? parseInt(rating) : null,
    },
  });
  res.status(201).json(feedback);
}
