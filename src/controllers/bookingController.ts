import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';

export async function listMyBookings(req: AuthRequest, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);

  const bookings = await prisma.booking.findMany({
    where: { user_id: req.user!.userId },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { business: { select: { id: true, company_name: true, logo_url: true, full_name: true } } },
  });
  res.json({ data: bookings, page, limit });
}

export async function listBusinessBookings(req: AuthRequest, res: Response): Promise<void> {
  const businessId = paramInt(req.params.businessId);
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const status = req.query.status as string | undefined;

  const card = await prisma.businessCard.findUnique({ where: { id: businessId } });
  if (!card) { res.status(404).json({ error: 'Business not found' }); return; }
  if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const where: any = { business_id: businessId };
  if (status) where.status = status;

  const bookings = await prisma.booking.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
  });
  res.json({ data: bookings, page, limit });
}

export async function getBooking(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, company_name: true, logo_url: true, full_name: true, phone: true } },
      user: { select: { id: true, name: true, phone: true, profile_picture: true } },
    },
  });
  if (!booking) { res.status(404).json({ error: 'Not found' }); return; }

  const userId = req.user!.userId;
  const isOwner = booking.user_id === userId;
  const isBusinessOwner = booking.business.id === booking.business_id;
  const isAdmin = req.user!.roles.includes('admin');
  if (!isOwner && !isBusinessOwner && !isAdmin) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  res.json(booking);
}

export async function createBooking(req: AuthRequest, res: Response): Promise<void> {
  const {
    business_id,
    business_name,
    mode,
    booking_date,
    booking_time,
    customer_name,
    customer_phone,
    notes,
  } = req.body;

  const businessId = parseInt(business_id, 10);
  if (!businessId) { res.status(400).json({ error: 'business_id is required' }); return; }

  const card = await prisma.businessCard.findUnique({ where: { id: businessId } });
  if (!card) { res.status(404).json({ error: 'Business not found' }); return; }

  const booking = await prisma.booking.create({
    data: {
      user_id: req.user!.userId,
      business_id: businessId,
      business_name: business_name || card.company_name || card.full_name,
      mode: mode || 'visit',
      booking_date: booking_date ? new Date(booking_date) : new Date(),
      booking_time: booking_time || '',
      customer_name: customer_name || '',
      customer_phone: customer_phone || '',
      notes: notes || null,
      status: 'pending',
    },
    include: { business: { select: { id: true, company_name: true, logo_url: true } } },
  });
  res.status(201).json(booking);
}

export async function updateBookingStatus(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const { status } = req.body;

  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` }); return;
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { business: { select: { user_id: true } } },
  });
  if (!booking) { res.status(404).json({ error: 'Not found' }); return; }

  const userId = req.user!.userId;
  const isCustomer = booking.user_id === userId;
  const isBusinessOwner = booking.business.user_id === userId;
  const isAdmin = req.user!.roles.includes('admin');

  if (status === 'cancelled' && !isCustomer && !isBusinessOwner && !isAdmin) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  if ((status === 'confirmed' || status === 'completed') && !isBusinessOwner && !isAdmin) {
    res.status(403).json({ error: 'Only the business owner can confirm/complete bookings' }); return;
  }

  const updated = await prisma.booking.update({ where: { id }, data: { status } });
  res.json(updated);
}
