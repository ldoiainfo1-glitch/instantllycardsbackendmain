import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt, queryStr, queryFloat } from '../utils/params';
import { createRazorpayOrder, getRazorpayPublicKey, verifyRazorpaySignature } from '../services/razorpayService';
import { logEvent } from '../utils/logger';
import { signAccessToken, signRefreshToken, hashToken, refreshTokenExpiry } from '../utils/jwt';
import { rankLabelToTier, tierToScore, effectiveTier } from '../utils/tierFeatures';

/**
 * Legacy category name mapping: new L0 root → old/misspelled values stored in BusinessPromotion.category[].
 * Built from co-occurrence analysis of 195,987 promo records on 2026-04-16.
 * Only the top values (covering ~90% of legacy data) are mapped.
 */
const LEGACY_CATEGORY_MAP: Record<string, string[]> = {
  'AC Services':              ['Ac & Appliances', 'AC & Appliances', 'AC Repair & Services', 'AC Installation Services'],
  'Agriculture':              ['Fertilizer Dealers'],
  'Apparel & Fashion':        ['Apprael & Fashion', 'Readymade Garment Retailers'],
  'Astrology & Spiritual':    ['Kundali Matching', 'Vastu Consultation'],
  'Automotive':               ['Car Repair & Services', 'Car Dealers'],
  'Beauty & Wellness':        ['Home Services Offered'],
  'Business Services':        ['GST Return', 'Accounting'],
  'Cinemas & Entertainment':  ['Cinema Halls', 'Parking Available'],
  'Cleaning Services':        ['Residential Cleaning Services', 'Eco Friendly Housekeeping', 'Housekeeping Services'],
  'Construction & Interior':  ['Interior Designers', 'Civil Contractors', 'Building'],
  'Digital Services':         ['Digitel Services', 'Digital marketing services', 'Digital Marketing Services'],
  'Education & Training':     ['Tutorials', 'Computer Training Institutes', 'Counselling Sessions'],
  'Electrical Services':      ['Electricians'],
  'Event Services':           ['Event Organisers'],
  'Financial Services':       ['Insurance Agents'],
  'Fitness':                  ['Fitness Centres', 'Gyms', 'Get Your Own Trainer'],
  'Groceries & Supermarkets': ['Grocier & Supermarket', 'Grocery Stores'],
  'Healthcare':               ['General'],
  'Home Design':              [''],
  'Home Maintenance':         ['Plumbers'],
  'Hotels & Hospitality':     [''],
  'IT & Computer':            ['It & Computer', 'Computer Repair & Services'],
  'Jewellery':                ['Jewellery Showrooms', 'Gold Jewellery', 'Pearl Jewellery'],
  'Matrimony':                ['Matrimonial Bureaus'],
  'Mobile Services':          ['Mobile Phone Repair & Services', 'Mobile Phone Dealers'],
  'Packers & Movers':         [''],
  'Pet Services':             ['Pets Available'],
  'Pharmaceuticals & Chemists': ['Chemists'],
  'Placement & Recruitment':  ['Placement & Recruitments', 'Placement Services (Candidate)'],
  'Printing & Publishing':    ['Flex', 'Book', 'Digital'],
  'Real Estate':              ['Estate Agents For Residential Rental', 'Real Estate Agents', 'Estate Agents For Residence', 'Estate Agents For Commercial Rental'],
  'Registration':             [''],
  'Scrap':                    ['Battery Scrap', 'Scrap Dealers'],
  'Security Services':        ['Bodyguard'],
  'Telecom & Internet Services': ['Internet Service Providers', 'Wifi Internet Service Providers'],
  'Transport':                ['Transporters'],
  'Travel & Tourism':         ['Travel Agents'],
  'Warehouse':                ['Warehouses On Rent'],
};

// Remove empty strings from the map
for (const key of Object.keys(LEGACY_CATEGORY_MAP)) {
  LEGACY_CATEGORY_MAP[key] = LEGACY_CATEGORY_MAP[key].filter(Boolean);
}

/**
 * Resolve a category name (leaf/L1/L0) into its full ancestor chain via Category table traversal.
 * Returns { leaf, parent, root, chain } where chain = [leaf, parent, root].filter(Boolean).
 * Falls back to [inputName] if no Category row is found.
 */
async function resolveCategoryChain(categoryName: string): Promise<{
  leaf: string;
  parent: string | null;
  root: string;
  chain: string[];
}> {
  const trimmed = categoryName.trim();
  if (!trimmed) return { leaf: trimmed, parent: null, root: trimmed, chain: [trimmed] };

  // Find the category node (case-insensitive)
  const node = await prisma.category.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' }, is_active: true },
    select: { id: true, name: true, parent_id: true, level: true },
  });

  if (!node) {
    // Not in tree — return input as-is
    return { leaf: trimmed, parent: null, root: trimmed, chain: [trimmed] };
  }

  // Walk up the parent chain
  const names: string[] = [node.name];
  let currentParentId = node.parent_id;
  while (currentParentId !== null) {
    const parentNode = await prisma.category.findUnique({
      where: { id: currentParentId },
      select: { id: true, name: true, parent_id: true },
    });
    if (!parentNode) break;
    names.push(parentNode.name);
    currentParentId = parentNode.parent_id;
  }

  // names = [leaf, ..., root] (leaf first, root last)
  const leaf = names[0];
  const root = names[names.length - 1];
  const parent = names.length >= 2 ? names[1] : null;

  return { leaf, parent, root, chain: [...new Set(names)] };
}

/**
 * Build the final match set for a category name:
 * 1. Tree traversal → chain (leaf + parent + root)
 * 2. Legacy mapping → old/misspelled names for the root
 * 3. Deduplicated union
 */
async function buildCategoryMatchSet(categoryName: string): Promise<string[]> {
  const { chain, root } = await resolveCategoryChain(categoryName);
  const legacyMatches = LEGACY_CATEGORY_MAP[root] || [];
  const matchSet = [...new Set([...chain, ...legacyMatches])];

  // STEP 1 — LOG CATEGORY CHAIN
  console.log('[CATEGORY-CHAIN]', {
    input: categoryName,
    leaf: chain[0],
    parent: chain.length >= 2 ? chain[1] : null,
    root,
    chain,
  });

  // STEP 2 — LOG LEGACY MAP HIT
  console.log('[CATEGORY-LEGACY]', {
    root,
    legacyMatches,
  });

  // STEP 3 — LOG FINAL MATCH SET
  console.log('[CATEGORY-MATCH-SET]', matchSet);

  return matchSet;
}

/**
 * Parse a category string (from legacy clients or business_cards) into individual category names.
 * Handles: "Parent > Sub1, Sub2" → ["Parent", "Sub1", "Sub2"]
 *          "Custom: xyz"         → ["xyz"]
 *          "SingleCategory"      → ["SingleCategory"]
 */
function parseCategoryStringBackend(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('Custom:')) {
    const custom = trimmed.slice('Custom:'.length).trim();
    return custom ? [custom] : [];
  }

  if (trimmed.includes('>')) {
    const [parentPart, ...rest] = trimmed.split('>');
    const parent = parentPart.trim();
    const subs = rest.join('>').split(',').map(s => s.trim()).filter(Boolean);
    const result: string[] = [];
    if (parent) result.push(parent);
    for (const sub of subs) {
      if (!result.includes(sub)) result.push(sub);
    }
    return result;
  }

  return [trimmed];
}

export async function listPromotions(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const listingType = typeof req.query.listing_type === 'string' ? req.query.listing_type.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

  // Backward-compatible default: active + non-expired + pending payment
  const now = new Date();
  const where: any = {
    OR: [
      { status: 'active', OR: [{ expiry_date: null }, { expiry_date: { gt: now } }] },
      { status: 'pending_payment' },
    ],
  };
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
  if (category) {
    const matchSet = await buildCategoryMatchSet(category);
    where.category = { hasSome: matchSet };

    // STEP 4 — VERIFY DB VALUES FOR TARGET PROMOTIONS (user_id 652)
    const promos = await prisma.businessPromotion.findMany({
      where: { user_id: 652 },
      select: { id: true, business_name: true, category: true },
    });
    console.log('[PROMO-CATEGORIES]', promos);

    // STEP 5 — CHECK MATCH MANUALLY
    for (const promo of promos) {
      console.log('[MATCH-CHECK]', {
        business: promo.business_name,
        categories: promo.category,
        intersects: (promo.category as string[]).some((c: string) => matchSet.includes(c)),
      });
    }
  }
  if (listingType) where.listing_type = listingType;
  if (status) { delete where.OR; where.status = status; }

  // STEP 6 — PRINT FINAL QUERY WHERE
  console.log('[FINAL-WHERE]', JSON.stringify(where, null, 2));

  const promotions = await prisma.businessPromotion.findMany({
    skip: (page - 1) * limit,
    take: limit,
    orderBy: [{ created_at: 'desc' }],
    where,
    select: {
      id: true,
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
      created_at: true,
      updated_at: true,
      plan_name: true,
      tier: true,
      plan_type: true,
      payment_status: true,
      status: true,
      expiry_date: true,
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
  const data = promotions.map((p: any) => {
    console.log('[PROMO-API] listPromotions', { id: p.id, tier: p.tier, status: p.status, payment_status: p.payment_status });
    return {
      ...p,
      effectiveTier: effectiveTier(p.tier ?? 'free', p.status),
      is_premium: (p.tier ?? 'free') !== 'free' && p.status === 'active',
    };
  });
  res.json({ data, page, limit });
}

export async function getPromotion(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const promo = await prisma.businessPromotion.findUnique({
    where: { id },
    select: {
      id: true,
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
      created_at: true,
      updated_at: true,
      plan_name: true,
      tier: true,
      plan_type: true,
      payment_status: true,
      status: true,
      expiry_date: true,
      business_card: true,
      user: { select: { id: true, name: true } },
    },
  });
  if (!promo) { res.status(404).json({ error: 'Not found' }); return; }
  console.log('[PROMO-API] getPromotion', { id: (promo as any).id, tier: (promo as any).tier, status: (promo as any).status, payment_status: (promo as any).payment_status });
  res.json({ ...promo, effectiveTier: effectiveTier((promo as any).tier ?? 'free', (promo as any).status) });
}

export async function  createPromotion(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const {
    business_name, owner_name, description, email, phone, whatsapp, website,
    business_hours, pincode, plot_no, building_name, street_name, landmark,
    area, city, state, category, business_card_id,
    listing_type, listing_intent, plan_type,
  } = req.body;

  // --- Category normalization ---
  // Accept string or string[]; parse "Parent > Sub1, Sub2" format; resolve full chain via tree
  const rawCategories: string[] = Array.isArray(category)
    ? category.map((s: string) => s.trim()).filter(Boolean)
    : typeof category === 'string' && category.trim()
      ? parseCategoryStringBackend(category.trim())
      : [];

  // Resolve each raw value through the category tree to get full chains + legacy aliases
  const resolvedSets = await Promise.all(rawCategories.map(c => buildCategoryMatchSet(c)));
  const normalizedCategory = [...new Set(resolvedSets.flat())];

  console.log('[PROMO-CREATE] Category normalization', {
    rawInput: category,
    parsed: rawCategories,
    normalized: normalizedCategory,
  });

  // Transaction-based idempotency: prevents duplicate promotions under concurrent requests
  const result = await prisma.$transaction(async (tx) => {
    if (business_card_id) {
      const existing = await tx.businessPromotion.findFirst({
        where: { business_card_id, user_id: userId },
        orderBy: { created_at: 'desc' },
      });
      if (existing) {
        // Active or pending_payment — return existing, don't duplicate
        if (existing.status === 'active' || existing.status === 'pending_payment') {
          return { created: false as const, promo: existing };
        }
        // cancelled / failed / expired — allow recreation (fall through)
      }
    }

    const promo = await tx.businessPromotion.create({
      data: {
        user_id: userId,
        business_card_id: business_card_id ?? null,
        business_name: business_name ?? null,
        owner_name: owner_name ?? null,
        description: description ?? null,
        email: email ?? null,
        phone: phone ?? null,
        whatsapp: whatsapp ?? null,
        website: website ?? null,
        business_hours: business_hours ?? null,
        pincode: pincode ?? null,
        plot_no: plot_no ?? null,
        building_name: building_name ?? null,
        street_name: street_name ?? null,
        landmark: landmark ?? null,
        area: area ?? null,
        city: city ?? null,
        state: state ?? null,
        category: normalizedCategory,
        listing_type: listing_type ?? 'free',
        listing_intent: listing_intent ?? 'free',
        plan_type: plan_type ?? 'free',
        tier: 'free',
        visibility_priority_score: 10,
        status: plan_type === 'premium' ? 'pending_payment' : 'active',
        payment_status: plan_type === 'premium' ? 'pending' : undefined,
      },
    });

    // Grant business role immediately on promotion creation (free or premium).
    // BUSINESS RULE: Role is NOT tied to payment — it is granted when the user
    // registers their business via the Promote Business flow.
    await tx.userRole.upsert({
      where: { user_id_role: { user_id: userId, role: 'business' } },
      update: {},
      create: { user_id: userId, role: 'business' },
    });
    console.log('[PROMO-CREATE] Ensured business role for userId:', userId);

    return { created: true as const, promo };
  });

  if (result.created) {
    // Return fresh tokens with updated roles (includes new business role)
    const roles = (await prisma.userRole.findMany({ where: { user_id: userId } })).map(r => r.role);
    const accessToken = signAccessToken({ userId, roles });
    const refreshToken = signRefreshToken({ userId, roles });
    await prisma.refreshToken.create({
      data: { user_id: userId, token_hash: hashToken(refreshToken), expires_at: refreshTokenExpiry() },
    });
    logEvent('PROMOTION_CREATED', { userId, promotionId: result.promo.id, plan_type: result.promo.plan_type });
    res.status(201).json({ ...result.promo, roles, accessToken, refreshToken });
  } else {
    res.status(200).json(result.promo);
  }
}

export async function updatePromotion(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  console.log('[PromotionController][updatePromotion] request', {
    id,
    userId: req.user?.userId,
    roles: req.user?.roles,
    bodyKeys: Object.keys(req.body || {}),
    requestedStatus: req.body?.status,
  });

  const promo = await prisma.businessPromotion.findUnique({ where: { id } });
  if (!promo) {
    console.log('[PromotionController][updatePromotion] not-found', { id });
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (promo.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    console.log('[PromotionController][updatePromotion] forbidden', {
      id,
      ownerUserId: promo.user_id,
      requesterUserId: req.user!.userId,
    });
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  // Whitelist only user-editable fields
  const allowed = [
    'business_name', 'owner_name', 'description', 'email', 'phone', 'whatsapp',
    'website', 'business_hours', 'pincode', 'plot_no', 'building_name', 'street_name',
    'landmark', 'area', 'city', 'state', 'category',
  ] as const;
  const data: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }

  if (req.body.status !== undefined) {
    const nextStatus = String(req.body.status);
    const allowedStatuses = ['draft', 'active', 'pending_payment', 'expired', 'cancelled'] as const;
    if (!allowedStatuses.includes(nextStatus as (typeof allowedStatuses)[number])) {
      console.log('[PromotionController][updatePromotion] invalid-status', {
        id,
        nextStatus,
        allowedStatuses,
      });
      res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(', ')}` });
      return;
    }
    data.status = nextStatus;
  }

  // Normalize category through tree resolution if it was updated
  if (data.category !== undefined) {
    const rawCats: string[] = Array.isArray(data.category)
      ? data.category.map((s: string) => s.trim()).filter(Boolean)
      : typeof data.category === 'string' && data.category.trim()
        ? parseCategoryStringBackend(data.category.trim())
        : [];
    const resolvedSets = await Promise.all(rawCats.map(c => buildCategoryMatchSet(c)));
    data.category = [...new Set(resolvedSets.flat())];
  }

  try {
    console.log('[PromotionController][updatePromotion] applying-update', {
      id,
      data,
    });
    const updated = await prisma.businessPromotion.update({ where: { id }, data });
    console.log('[PromotionController][updatePromotion] success', {
      id,
      previousStatus: promo.status,
      updatedStatus: updated.status,
    });
    res.json(updated);
  } catch (error: any) {
    console.error('[PromotionController][updatePromotion] failed', {
      id,
      data,
      message: error?.message,
      code: error?.code,
    });
    res.status(500).json({ error: 'Failed to update promotion' });
  }
}

export async function deletePromotion(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  console.log('[PromotionController][deletePromotion] request', {
    id,
    userId: req.user?.userId,
    roles: req.user?.roles,
  });

  const promo = await prisma.businessPromotion.findUnique({ where: { id } });
  if (!promo) {
    console.log('[PromotionController][deletePromotion] not-found', { id });
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (promo.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
    console.log('[PromotionController][deletePromotion] forbidden', {
      id,
      ownerUserId: promo.user_id,
      requesterUserId: req.user!.userId,
    });
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    await prisma.businessPromotion.delete({ where: { id } });
    console.log('[PromotionController][deletePromotion] success', { id });
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('[PromotionController][deletePromotion] failed', {
      id,
      message: error?.message,
      code: error?.code,
    });
    if (error?.code === 'P2003') {
      res.status(409).json({ error: 'Promotion has related data and cannot be deleted permanently' });
      return;
    }
    res.status(500).json({ error: 'Failed to delete promotion permanently' });
  }
}

export async function getMyPromotions(req: AuthRequest, res: Response): Promise<void> {
  const promotions = await prisma.businessPromotion.findMany({
    where: { user_id: req.user!.userId },
    select: {
      id: true,
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
      created_at: true,
      updated_at: true,
      plan_name: true,
      tier: true,
      plan_type: true,
      payment_status: true,
      status: true,
      expiry_date: true,
    },
    orderBy: { created_at: 'desc' },
  });
  res.json(promotions.map((p: any) => {
    console.log('[PROMO-API] getMyPromotions', { id: p.id, tier: p.tier, status: p.status, payment_status: p.payment_status });
    return {
      ...p,
      effectiveTier: effectiveTier(p.tier ?? 'free', p.status),
    };
  }));
}

/**
 * GET /promotions/pricing-plans
 * Returns all active pricing plans for premium listings.
 */
export async function listPricingPlans(_req: Request, res: Response): Promise<void> {
  try {
    const plans = await prisma.promotionPricingPlan.findMany({
      where: { is_active: true },
      orderBy: { rank: 'asc' },
    });
    res.json(plans);
  } catch (err) {
    console.error('[PRICING-PLANS] Failed', err);
    res.status(500).json({ error: 'Failed to fetch pricing plans' });
  }
}

/**
 * POST /promotions/:id/payment-intent
 * Creates a Razorpay order for a promotion's premium plan.
 * Body: { pricing_plan_id: number }
 */
export async function createPromotionPaymentIntent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const promoId = paramInt(req.params.id);
    const { pricing_plan_id } = req.body;

    if (!pricing_plan_id) {
      res.status(400).json({ error: 'pricing_plan_id is required' });
      return;
    }

    const promo = await prisma.businessPromotion.findUnique({ where: { id: promoId } });
    if (!promo) { res.status(404).json({ error: 'Promotion not found' }); return; }
    if (promo.user_id !== req.user!.userId) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }

    const plan = await prisma.promotionPricingPlan.findUnique({ where: { id: pricing_plan_id } });
    if (!plan || !plan.is_active) {
      res.status(404).json({ error: 'Pricing plan not found or inactive' }); return;
    }

    // Check for existing unpaid order and reuse it
    const existingOrder = await prisma.promotionOrder.findFirst({
      where: {
        business_promotion_id: promoId,
        pricing_plan_id: plan.id,
        status: 'created',
      },
    });

    if (existingOrder?.payment_order_id) {
      res.json({
        key: getRazorpayPublicKey(),
        order_id: existingOrder.payment_order_id,
        amount: Math.round(existingOrder.payable_amount * 100),
        currency: existingOrder.currency,
        promotion_order_id: existingOrder.id,
      });
      return;
    }

    const amountPaise = Math.round(plan.amount * 100);

    const razorpayOrder = await createRazorpayOrder({
      amountPaise,
      currency: plan.currency || 'INR',
      receipt: `promo_${promoId}_plan_${plan.id}`,
      notes: {
        promotion_id: String(promoId),
        plan_code: plan.code,
        user_id: String(req.user!.userId),
      },
    });

    const order = await prisma.promotionOrder.create({
      data: {
        user_id: req.user!.userId,
        business_promotion_id: promoId,
        pricing_plan_id: plan.id,
        area_type: plan.area_type,
        rank: plan.rank,
        rank_label: plan.rank_label,
        amount: plan.amount,
        payable_amount: plan.amount,
        currency: plan.currency || 'INR',
        duration_days: plan.duration_days,
        priority_score: plan.priority_score,
        status: 'created',
        payment_provider: 'razorpay',
        payment_order_id: razorpayOrder.id,
      },
    });

    console.log('[PROMO-PAYMENT] Order created:', { orderId: order.id, razorpayOrderId: razorpayOrder.id, amount: plan.amount });

    res.json({
      key: getRazorpayPublicKey(),
      order_id: razorpayOrder.id,
      amount: amountPaise,
      currency: plan.currency || 'INR',
      promotion_order_id: order.id,
    });
  } catch (err) {
    console.error('[PROMO-PAYMENT] Failed', err);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
}

/**
 * POST /promotions/:id/verify-payment
 * Verifies Razorpay payment and activates the promotion plan.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
export async function verifyPromotionPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const promoId = paramInt(req.params.id);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).json({ error: 'Payment verification fields are required' });
      return;
    }

    // Verify signature
    const isValid = verifyRazorpaySignature({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });

    if (!isValid) {
      console.error('[PROMO-VERIFY] Invalid signature for promo', promoId);
      res.status(400).json({ error: 'Invalid payment signature' });
      return;
    }

    // Find the order
    const order = await prisma.promotionOrder.findFirst({
      where: {
        business_promotion_id: promoId,
        payment_order_id: razorpay_order_id,
        status: 'created',
      },
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found or already processed' });
      return;
    }

    if (order.user_id !== req.user!.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + order.duration_days * 24 * 60 * 60 * 1000);
    const tier = rankLabelToTier(order.rank_label);

    // Update order + promotion in a transaction
    const [updatedOrder, updatedPromo] = await prisma.$transaction([
      prisma.promotionOrder.update({
        where: { id: order.id },
        data: {
          status: 'paid',
          payment_id: razorpay_payment_id,
          paid_at: now,
          activated_at: now,
          expires_at: expiresAt,
        },
      }),
      prisma.businessPromotion.update({
        where: { id: promoId },
        data: {
          payment_status: 'completed',
          payment_id: razorpay_payment_id,
          plan_name: order.rank_label,
          plan_price: order.payable_amount,
          plan_duration_days: order.duration_days,
          plan_activated_at: now,
          plan_type: 'premium',
          tier,
          listing_type: 'premium',
          listing_intent: 'premium',
          status: 'active',
          expiry_date: expiresAt,
          visibility_priority_score: tierToScore(tier),
        },
      }),
    ]);

    // Grant business role (upsert to prevent duplicates)
    // BUSINESS RULE: The 'business' role is PERMANENT — never revoke on expiry.
    // Once granted through payment, a user remains a business user forever.
    await prisma.userRole.upsert({
      where: { user_id_role: { user_id: req.user!.userId, role: 'business' } },
      update: {},
      create: { user_id: req.user!.userId, role: 'business' },
    });
    console.log('[PROMO-VERIFY] Ensured business role for userId:', req.user!.userId);

    // Return updated roles + fresh tokens so the client JWT reflects the new role
    const roles = (await prisma.userRole.findMany({
      where: { user_id: req.user!.userId },
    })).map(r => r.role);

    const accessToken = signAccessToken({ userId: req.user!.userId, roles });
    const refreshToken = signRefreshToken({ userId: req.user!.userId, roles });
    await prisma.refreshToken.create({
      data: {
        user_id: req.user!.userId,
        token_hash: hashToken(refreshToken),
        expires_at: refreshTokenExpiry(),
      },
    });

    logEvent('PAYMENT_SUCCESS', {
      userId: req.user!.userId,
      promotionId: promoId,
      orderId: order.id,
      amount: order.payable_amount,
      plan_type: 'premium',
    });

    console.log('[PROMO-VERIFY] Payment verified:', { orderId: order.id, promoId, expiresAt });

    res.json({
      success: true,
      order: updatedOrder,
      promotion: updatedPromo,
      roles,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('[PROMO-VERIFY] Failed', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
}

/**
 * POST /promotions/:id/retry-payment
 * Allows retry for promotions stuck in pending_payment status.
 * Body: { pricing_plan_id: number }
 */
export async function retryPromotionPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const promoId = paramInt(req.params.id);
    const { pricing_plan_id } = req.body;

    if (!pricing_plan_id) {
      res.status(400).json({ error: 'pricing_plan_id is required' });
      return;
    }

    const promo = await prisma.businessPromotion.findUnique({ where: { id: promoId } });
    if (!promo) { res.status(404).json({ error: 'Promotion not found' }); return; }
    if (promo.user_id !== req.user!.userId) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }

    // Only allow retry for pending_payment promotions
    if (promo.status !== 'pending_payment') {
      res.status(409).json({ error: `Cannot retry payment — promotion status is '${promo.status}'` });
      return;
    }

    const plan = await prisma.promotionPricingPlan.findUnique({ where: { id: pricing_plan_id } });
    if (!plan || !plan.is_active) {
      res.status(404).json({ error: 'Pricing plan not found or inactive' }); return;
    }

    const amountPaise = Math.round(plan.amount * 100);

    const razorpayOrder = await createRazorpayOrder({
      amountPaise,
      currency: plan.currency || 'INR',
      receipt: `promo_${promoId}_retry_${Date.now()}`,
      notes: {
        promotion_id: String(promoId),
        plan_code: plan.code,
        user_id: String(req.user!.userId),
        retry: 'true',
      },
    });

    const order = await prisma.promotionOrder.create({
      data: {
        user_id: req.user!.userId,
        business_promotion_id: promoId,
        pricing_plan_id: plan.id,
        area_type: plan.area_type,
        rank: plan.rank,
        rank_label: plan.rank_label,
        amount: plan.amount,
        payable_amount: plan.amount,
        currency: plan.currency || 'INR',
        duration_days: plan.duration_days,
        priority_score: plan.priority_score,
        status: 'created',
        payment_provider: 'razorpay',
        payment_order_id: razorpayOrder.id,
      },
    });

    logEvent('PAYMENT_RETRY', { userId: req.user!.userId, promotionId: promoId, orderId: order.id });

    res.json({
      key: getRazorpayPublicKey(),
      order_id: razorpayOrder.id,
      amount: amountPaise,
      currency: plan.currency || 'INR',
      promotion_order_id: order.id,
    });
  } catch (err) {
    console.error('[PROMO-RETRY] Failed', err);
    res.status(500).json({ error: 'Failed to create retry payment' });
  }
}


export async function listPromotionsNearby(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = Math.min(queryInt(req.query.limit, 20), 50);
  const search = queryStr(req.query.search)?.trim() || '';
  const category = queryStr(req.query.category)?.trim() || '';
  const listingType = queryStr(req.query.listing_type)?.trim() || '';
  const status = queryStr(req.query.status)?.trim() || '';
  const city = queryStr(req.query.city)?.trim() || '';
  const state = queryStr(req.query.state)?.trim() || '';
  const lat = queryFloat(req.query.lat, NaN);
  const lng = queryFloat(req.query.lng, NaN);
  const radiusMeters = queryFloat(req.query.radius, 5000);
  const radiusKm = radiusMeters / 1000;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  // Resolve category match set once (tree traversal + legacy map), reuse in both Prisma and raw SQL paths
  const categoryMatchValues = category ? await buildCategoryMatchSet(category) : [];

  const buildWhere = () => {
    const now = new Date();
    // Default: show active free + active non-expired premium + pending_payment (as free fallback)
    const where: any = {
      OR: [
        { plan_type: 'free', status: 'active' },
        { plan_type: 'premium', status: 'active', expiry_date: { gt: now } },
        { status: 'pending_payment' },
      ],
    };
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
    if (categoryMatchValues.length > 0) where.category = { hasSome: categoryMatchValues };
    if (listingType) where.listing_type = listingType;
    if (status) { delete where.OR; where.status = status; }
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state = { contains: state, mode: 'insensitive' };
    return where;
  };

  if (!hasCoords) {
    const promotions = await prisma.businessPromotion.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ visibility_priority_score: 'desc' }, { created_at: 'desc' }],
      where: buildWhere(),
      select: {
        id: true,
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
        created_at: true,
        updated_at: true,
        plan_name: true,
        plan_type: true,
        tier: true,
        payment_status: true,
        status: true,
        expiry_date: true,
        visibility_priority_score: true,
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
    const data = promotions.map((p: any) => ({
      ...p,
      effectiveTier: effectiveTier(p.tier, p.status),
      is_premium: p.tier !== 'free' && p.status === 'active',
    }));
    res.json({ data, page, limit });
    return;
  }

  const filters: Prisma.Sql[] = [
    Prisma.sql`(
      (p."plan_type" = 'free' AND p."status" = 'active')
      OR (p."plan_type" = 'premium' AND p."status" = 'active' AND p."expiry_date" > NOW())
      OR (p."status" = 'pending_payment')
    )`,
  ];
  if (listingType) filters.push(Prisma.sql`p."listing_type" = ${listingType}`);
  if (status) { filters.length = 0; filters.push(Prisma.sql`p."status" = ${status}`); }
  if (categoryMatchValues.length > 0) filters.push(Prisma.sql`p."category" && ARRAY[${Prisma.join(categoryMatchValues)}]::text[]`);
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
    ORDER BY p."visibility_priority_score" DESC, distance_km ASC, p."created_at" DESC
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
      created_at: true,
      updated_at: true,
      plan_name: true,
      plan_type: true,
      tier: true,
      payment_status: true,
      status: true,
      expiry_date: true,
      visibility_priority_score: true,
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
  const data = rows.map((row) => {
    const p = promoMap.get(row.id)! as any;
    return { ...p, distance_km: row.distance_km, effectiveTier: effectiveTier(p.tier, p.status), is_premium: p.tier !== 'free' && p.status === 'active' };
  });
  res.json({ data, page, limit });
}
