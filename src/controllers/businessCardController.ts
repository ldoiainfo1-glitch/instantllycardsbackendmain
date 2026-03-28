import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt, queryStr } from '../utils/params';

export async function listCards(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const search = queryStr(req.query.search);

  const cards = await prisma.businessCard.findMany({
    where: search
      ? {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { company_name: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      user_id: true,
      full_name: true,
      phone: true,
      email: true,
      company_name: true,
      job_title: true,
      logo_url: true,
      description: true,
      category: true,
      services: true,
      offer: true,
      website: true,
      business_hours: true,
      location: true,
      maps_link: true,
      whatsapp: true,
      telegram: true,
      instagram: true,
      facebook: true,
      linkedin: true,
      youtube: true,
      twitter: true,
      company_phone: true,
      company_email: true,
      company_address: true,
      company_maps_link: true,
      keywords: true,
      established_year: true,
      gender: true,
      birthdate: true,
      anniversary: true,
      created_at: true,
      updated_at: true,
    },
  });
  res.json({ data: cards, page, limit });
}

export async function getCard(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const card = await prisma.businessCard.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, profile_picture: true } },
      reviews: { take: 5, orderBy: { created_at: 'desc' } },
      vouchers: { where: { status: 'active' }, take: 5 },
    },
  });
  if (!card) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(card);
}

export async function createCard(req: AuthRequest, res: Response): Promise<void> {
  const data = req.body;
  const card = await prisma.businessCard.create({
    data: { ...data, user_id: req.user!.userId },
  });

  // Ensure user has business role
  const existing = await prisma.userRole.findFirst({
    where: { user_id: req.user!.userId, role: 'business' },
  });
  if (!existing) {
    await prisma.userRole.create({ data: { user_id: req.user!.userId, role: 'business' } });
  }

  res.status(201).json(card);
}

export async function updateCard(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const card = await prisma.businessCard.findUnique({ where: { id } });
  if (!card) { res.status(404).json({ error: 'Not found' }); return; }
  if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  const updated = await prisma.businessCard.update({ where: { id }, data: req.body });
  res.json(updated);
}

export async function deleteCard(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const card = await prisma.businessCard.findUnique({ where: { id } });
  if (!card) { res.status(404).json({ error: 'Not found' }); return; }
  if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  await prisma.businessCard.delete({ where: { id } });
  res.json({ message: 'Deleted' });
}

export async function getMyCards(req: AuthRequest, res: Response): Promise<void> {
  const cards = await prisma.businessCard.findMany({
    where: { user_id: req.user!.userId },
    orderBy: { created_at: 'desc' },
  });
  res.json(cards);
}

export async function shareCard(req: AuthRequest, res: Response): Promise<void> {
  const { card_id, recipient_user_id, message } = req.body;
  const sender = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  const card = await prisma.businessCard.findUnique({ where: { id: parseInt(card_id) } });
  if (!card || !sender) { res.status(404).json({ error: 'Card or sender not found' }); return; }

  const recipient = recipient_user_id
    ? await prisma.user.findUnique({ where: { id: parseInt(recipient_user_id) } })
    : null;

  const share = await prisma.sharedCard.create({
    data: {
      card_id: card.id,
      sender_id: String(sender.id),
      recipient_id: recipient ? String(recipient.id) : '0',
      message: message || null,
      card_title: card.company_name || card.full_name,
      sender_name: sender.name || sender.phone,
      recipient_name: recipient?.name || recipient?.phone || 'Unknown',
      card_photo: card.company_photo || card.logo_url,
      sender_profile_picture: sender.profile_picture,
    },
  });
  res.status(201).json(share);
}

export async function getSharedCards(req: AuthRequest, res: Response): Promise<void> {
  const userId = String(req.user!.userId);
  const shares = await prisma.sharedCard.findMany({
    where: { OR: [{ recipient_id: userId }, { sender_id: userId }] },
    include: { card: true },
    orderBy: { created_at: 'desc' },
  });
  res.json(shares);
}
