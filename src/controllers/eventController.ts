import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';
import crypto from 'crypto';

export async function listEvents(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;

  const where: any = { status: 'active' };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
    ];
  }

  const events = await prisma.event.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { date: 'asc' },
    include: {
      business: { select: { id: true, company_name: true, logo_url: true, full_name: true } },
      _count: { select: { registrations: true } },
    },
  });
  res.json({ data: events, page, limit });
}

export async function getEvent(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, company_name: true, logo_url: true, full_name: true, phone: true } },
      _count: { select: { registrations: true } },
    },
  });
  if (!event) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(event);
}

export async function listMyEvents(req: AuthRequest, res: Response): Promise<void> {
  const cards = await prisma.businessCard.findMany({
    where: { user_id: req.user!.userId },
    select: { id: true },
  });
  const cardIds = cards.map((c) => c.id);

  const events = await prisma.event.findMany({
    where: { business_id: { in: cardIds } },
    orderBy: { date: 'desc' },
    include: { _count: { select: { registrations: true } } },
  });
  res.json(events);
}

export async function createEvent(req: AuthRequest, res: Response): Promise<void> {
  const {
    business_id,
    title,
    description,
    date,
    time,
    location,
    image_url,
    ticket_price,
    max_attendees,
  } = req.body;

  console.log('[createEvent] body:', JSON.stringify(req.body));
  console.log('[createEvent] user:', req.user?.userId, 'roles:', req.user?.roles);

  const businessId = parseInt(business_id, 10);
  if (!businessId || !title || !date || !time) {
    console.log('[createEvent] validation failed — businessId:', businessId, 'title:', title, 'date:', date, 'time:', time);
    res.status(400).json({ error: 'business_id, title, date, and time are required' }); return;
  }

  const card = await prisma.businessCard.findUnique({ where: { id: businessId } });
  if (!card) {
    console.log('[createEvent] business card not found for id:', businessId);
    res.status(404).json({ error: 'Business not found' }); return;
  }
  if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    console.log('[createEvent] forbidden — card.user_id:', card.user_id, 'req.user.userId:', req.user!.userId);
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  try {
    const event = await prisma.event.create({
      data: {
        business_id: businessId,
        title,
        description: description || null,
        date: new Date(date),
        time,
        location: location || null,
        image_url: image_url || null,
        ticket_price: ticket_price ? parseFloat(ticket_price) : null,
        max_attendees: max_attendees ? parseInt(max_attendees, 10) : null,
        status: 'active',
      },
      include: { business: { select: { id: true, company_name: true } } },
    });
    console.log('[createEvent] success — event.id:', event.id);
    res.status(201).json(event);
  } catch (err) {
    console.error('[createEvent] prisma error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateEvent(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const event = await prisma.event.findUnique({
    where: { id },
    include: { business: { select: { user_id: true } } },
  });
  if (!event) { res.status(404).json({ error: 'Not found' }); return; }
  if (event.business.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const allowedFields = ['title', 'description', 'date', 'time', 'location', 'image_url', 'ticket_price', 'max_attendees', 'status'];
  const data: any = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      if (key === 'date') data[key] = new Date(req.body[key]);
      else if (key === 'ticket_price') data[key] = parseFloat(req.body[key]);
      else if (key === 'max_attendees') data[key] = parseInt(req.body[key], 10);
      else data[key] = req.body[key];
    }
  }

  const updated = await prisma.event.update({ where: { id }, data });
  res.json(updated);
}

export async function registerForEvent(req: AuthRequest, res: Response): Promise<void> {
  const eventId = paramInt(req.params.id);
  const { ticket_count } = req.body;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
  if (event.status !== 'active') { res.status(400).json({ error: 'Event is not active' }); return; }

  if (event.max_attendees && event.attendee_count >= event.max_attendees) {
    res.status(400).json({ error: 'Event is full' }); return;
  }

  const existing = await prisma.eventRegistration.findFirst({
    where: { event_id: eventId, user_id: req.user!.userId },
  });
  if (existing) { res.status(409).json({ error: 'Already registered', registration: existing }); return; }

  const count = ticket_count ? parseInt(ticket_count, 10) : 1;
  const qrCode = `EVT-${eventId}-${crypto.randomBytes(6).toString('hex')}`;

  const [registration] = await prisma.$transaction([
    prisma.eventRegistration.create({
      data: {
        event_id: eventId,
        user_id: req.user!.userId,
        ticket_count: count,
        qr_code: qrCode,
      },
    }),
    prisma.event.update({
      where: { id: eventId },
      data: { attendee_count: { increment: count } },
    }),
  ]);

  res.status(201).json({ ...registration, qr_code: qrCode });
}

export async function getEventRegistrations(req: AuthRequest, res: Response): Promise<void> {
  const eventId = paramInt(req.params.id);

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { business: { select: { user_id: true } } },
  });
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
  if (event.business.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const registrations = await prisma.eventRegistration.findMany({
    where: { event_id: eventId },
    include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
    orderBy: { registered_at: 'desc' },
  });
  res.json(registrations);
}

export async function getMyRegistrations(req: AuthRequest, res: Response): Promise<void> {
  const registrations = await prisma.eventRegistration.findMany({
    where: { user_id: req.user!.userId },
    include: { event: true },
    orderBy: { registered_at: 'desc' },
  });
  res.json(registrations);
}
