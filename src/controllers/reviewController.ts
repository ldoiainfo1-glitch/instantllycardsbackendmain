import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt } from '../utils/params';

export async function getCardReviews(req: Request, res: Response): Promise<void> {
  const cardId = paramInt(req.params.cardId);
  const reviews = await prisma.review.findMany({
    where: { business_id: cardId },
    include: { user: { select: { id: true, name: true, profile_picture: true } } },
    orderBy: { created_at: 'desc' },
  });
  res.json(reviews);
}

export async function createReview(req: AuthRequest, res: Response): Promise<void> {
  const { business_id, rating, comment, photo_url } = req.body;

  const existing = await prisma.review.findFirst({
    where: { business_id: parseInt(business_id), user_id: req.user!.userId },
  });
  if (existing) { res.status(409).json({ error: 'Already reviewed' }); return; }

  const review = await prisma.review.create({
    data: {
      business_id: parseInt(business_id),
      user_id: req.user!.userId,
      rating: parseInt(rating),
      comment: comment || null,
      photo_url: photo_url || null,
    },
  });
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
