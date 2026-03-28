import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt, queryStr, queryFloat } from '../utils/params';

export async function listPromotions(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const listingType = typeof req.query.listing_type === 'string' ? req.query.listing_type.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const isActiveRaw = typeof req.query.is_active === 'string' ? req.query.is_active.trim() : '';
  const isActive =
    isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;

  const where: any = {};
  if (search) {
    where.OR = [
      { business_name: { contains: search, mode: 'insensitive' } },
      { owner_name: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } },
      { state: { contains: search, mode: 'insensitive' } },
      { area: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (category) where.category = { has: category };
  if (listingType) where.listing_type = listingType;
  if (status) where.status = status;
  if (isActive !== undefined) where.is_active = isActive;

  const promotions = await prisma.businessPromotion.findMany({
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    where,
    select: {
      id: true,
      user_id: true,
      business_card_id: true,
      business_name: true,
      owner_name: true,
      description: true,
      category: true,
      email: true,
      phone: true,
      whatsapp: true,
      website: true,
      business_hours: true,
      area: true,
      pincode: true,
      plot_no: true,
      building_name: true,
      street_name: true,
      landmark: true,
      city: true,
      state: true,
      listing_type: true,
      listing_intent: true,
      status: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      business_card: {
        select: {
          id: true,
          logo_url: true,
          services: true,
          offer: true,
          job_title: true,
          company_name: true,
          category: true,
          location: true,
          maps_link: true,
          instagram: true,
          facebook: true,
          linkedin: true,
          youtube: true,
          twitter: true,
          telegram: true,
          company_phone: true,
          company_email: true,
          company_address: true,
          company_maps_link: true,
          keywords: true,
          established_year: true,
          gender: true,
          birthdate: true,
          anniversary: true,
          whatsapp: true,
          phone: true,
          email: true,
          business_hours: true,
        },
      },
    },
  });
  res.json({ data: promotions, page, limit });
}

export async function getPromotion(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const promo = await prisma.businessPromotion.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } }, business_card: true },
  });
  if (!promo) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(promo);
}

export async function createPromotion(req: AuthRequest, res: Response): Promise<void> {
  const promo = await prisma.businessPromotion.create({
    data: { ...req.body, user_id: req.user!.userId },
  });
  res.status(201).json(promo);
}

export async function updatePromotion(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const promo = await prisma.businessPromotion.findUnique({ where: { id } });
  if (!promo) { res.status(404).json({ error: 'Not found' }); return; }
  if (promo.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  const updated = await prisma.businessPromotion.update({ where: { id }, data: req.body });
  res.json(updated);
}

export async function getMyPromotions(req: AuthRequest, res: Response): Promise<void> {
  const promotions = await prisma.businessPromotion.findMany({
    where: { user_id: req.user!.userId },
    orderBy: { created_at: 'desc' },
  });
  res.json(promotions);
}


export async function listPromotionsNearby(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = Math.min(queryInt(req.query.limit, 20), 50);
  const search = queryStr(req.query.search)?.trim() || '';
  const category = queryStr(req.query.category)?.trim() || '';
  const listingType = queryStr(req.query.listing_type)?.trim() || '';
  const status = queryStr(req.query.status)?.trim() || '';
  const isActiveRaw = queryStr(req.query.is_active)?.trim() || '';
  const isActive = isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;
  const city = queryStr(req.query.city)?.trim() || '';
  const state = queryStr(req.query.state)?.trim() || '';
  const lat = queryFloat(req.query.lat, NaN);
  const lng = queryFloat(req.query.lng, NaN);
  const radiusMeters = queryFloat(req.query.radius, 5000);
  const radiusKm = radiusMeters / 1000;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const buildWhere = () => {
    const where: any = {};
    if (search) {
      where.OR = [
        { business_name: { contains: search, mode: 'insensitive' } },
        { owner_name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } },
        { area: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = { has: category };
    if (listingType) where.listing_type = listingType;
    if (status) where.status = status;
    if (isActive !== undefined) where.is_active = isActive;
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state = { contains: state, mode: 'insensitive' };
    return where;
  };

  if (!hasCoords) {
    const promotions = await prisma.businessPromotion.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { created_at: 'desc' },
      where: buildWhere(),
      select: {
        id: true,
        user_id: true,
        business_card_id: true,
        business_name: true,
        owner_name: true,
        description: true,
        category: true,
        email: true,
        phone: true,
        whatsapp: true,
        website: true,
        business_hours: true,
        area: true,
        pincode: true,
        plot_no: true,
        building_name: true,
        street_name: true,
        landmark: true,
        city: true,
        state: true,
        listing_type: true,
        listing_intent: true,
        status: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        business_card: {
          select: {
            id: true,
            logo_url: true,
            services: true,
            offer: true,
            job_title: true,
            company_name: true,
            category: true,
            location: true,
            maps_link: true,
            instagram: true,
            facebook: true,
            linkedin: true,
            youtube: true,
            twitter: true,
            telegram: true,
            company_phone: true,
            company_email: true,
            company_address: true,
            company_maps_link: true,
            keywords: true,
            established_year: true,
            gender: true,
            birthdate: true,
            anniversary: true,
            whatsapp: true,
            phone: true,
            email: true,
            business_hours: true,
          },
        },
      },
    });
    res.json({ data: promotions, page, limit });
    return;
  }

  const filters: Prisma.Sql[] = [];
  if (listingType) filters.push(Prisma.sql`p."listing_type" = ${listingType}`);
  if (status) filters.push(Prisma.sql`p."status" = ${status}`);
  if (isActive !== undefined) filters.push(Prisma.sql`p."is_active" = ${isActive}`);
  if (category) filters.push(Prisma.sql`p."category" && ARRAY[${category}]::text[]`);
  if (city) filters.push(Prisma.sql`p."city" ILIKE ${'%' + city + '%'}`);
  if (state) filters.push(Prisma.sql`p."state" ILIKE ${'%' + state + '%'}`);
  if (search) {
    const like = `%${search}%`;
    filters.push(Prisma.sql`(p."business_name" ILIKE ${like} OR p."owner_name" ILIKE ${like} OR p."city" ILIKE ${like} OR p."state" ILIKE ${like} OR p."area" ILIKE ${like} OR p."phone" ILIKE ${like} OR p."email" ILIKE ${like})`);
  }
  const whereSql = filters.length > 0 ? Prisma.sql`AND ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ id: number; distance_km: number }>>(Prisma.sql`
    SELECT p.id,
      (6371 * acos(
        cos(radians(${lat})) * cos(radians(bl.lat)) * cos(radians(bl.lng) - radians(${lng})) +
        sin(radians(${lat})) * sin(radians(bl.lat))
      )) AS distance_km
    FROM "BusinessPromotion" p
    JOIN "BusinessCard" c ON c.id = p."business_card_id"
    JOIN "BusinessLocation" bl ON bl."business_id" = c.id
    WHERE bl.lat IS NOT NULL AND bl.lng IS NOT NULL
      AND (bl."is_primary" = true OR bl."is_primary" IS NULL)
      AND (
        (6371 * acos(
          cos(radians(${lat})) * cos(radians(bl.lat)) * cos(radians(bl.lng) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(bl.lat))
        )) <= ${radiusKm}
      )
      ${Prisma.sql` `}
      ${whereSql}
    ORDER BY distance_km ASC, p."created_at" DESC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}
  `);

  if (rows.length === 0) {
    res.json({ data: [], page, limit });
    return;
  }

  const ids = rows.map((r) => r.id);
  const promos = await prisma.businessPromotion.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      user_id: true,
      business_card_id: true,
      business_name: true,
      owner_name: true,
      description: true,
      category: true,
      email: true,
      phone: true,
      whatsapp: true,
      website: true,
      business_hours: true,
      area: true,
      pincode: true,
      plot_no: true,
      building_name: true,
      street_name: true,
      landmark: true,
      city: true,
      state: true,
      listing_type: true,
      listing_intent: true,
      status: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      business_card: {
        select: {
          id: true,
          logo_url: true,
          services: true,
          offer: true,
          job_title: true,
          company_name: true,
          category: true,
          location: true,
          maps_link: true,
          instagram: true,
          facebook: true,
          linkedin: true,
          youtube: true,
          twitter: true,
          telegram: true,
          company_phone: true,
          company_email: true,
          company_address: true,
          company_maps_link: true,
          keywords: true,
          established_year: true,
          gender: true,
          birthdate: true,
          anniversary: true,
          whatsapp: true,
          phone: true,
          email: true,
          business_hours: true,
        },
      },
    },
  });

  const promoMap = new Map(promos.map((p) => [p.id, p]));
  const data = rows.map((row) => ({ ...promoMap.get(row.id)!, distance_km: row.distance_km }));
  res.json({ data, page, limit });
}
