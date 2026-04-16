"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPromotions = listPromotions;
exports.getPromotion = getPromotion;
exports.createPromotion = createPromotion;
exports.updatePromotion = updatePromotion;
exports.getMyPromotions = getMyPromotions;
exports.listPricingPlans = listPricingPlans;
exports.createPromotionPaymentIntent = createPromotionPaymentIntent;
exports.verifyPromotionPayment = verifyPromotionPayment;
exports.retryPromotionPayment = retryPromotionPayment;
exports.listPromotionsNearby = listPromotionsNearby;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const razorpayService_1 = require("../services/razorpayService");
const logger_1 = require("../utils/logger");
const jwt_1 = require("../utils/jwt");
const tierFeatures_1 = require("../utils/tierFeatures");
/**
 * Legacy category name mapping: new L0 root → old/misspelled values stored in BusinessPromotion.category[].
 * Built from co-occurrence analysis of 195,987 promo records on 2026-04-16.
 * Only the top values (covering ~90% of legacy data) are mapped.
 */
const LEGACY_CATEGORY_MAP = {
    'AC Services': ['Ac & Appliances', 'AC & Appliances', 'AC Repair & Services', 'AC Installation Services'],
    'Agriculture': ['Fertilizer Dealers'],
    'Apparel & Fashion': ['Apprael & Fashion', 'Readymade Garment Retailers'],
    'Astrology & Spiritual': ['Kundali Matching', 'Vastu Consultation'],
    'Automotive': ['Car Repair & Services', 'Car Dealers'],
    'Beauty & Wellness': ['Home Services Offered'],
    'Business Services': ['GST Return', 'Accounting'],
    'Cinemas & Entertainment': ['Cinema Halls', 'Parking Available'],
    'Cleaning Services': ['Residential Cleaning Services', 'Eco Friendly Housekeeping', 'Housekeeping Services'],
    'Construction & Interior': ['Interior Designers', 'Civil Contractors', 'Building'],
    'Digital Services': ['Digitel Services', 'Digital marketing services', 'Digital Marketing Services'],
    'Education & Training': ['Tutorials', 'Computer Training Institutes', 'Counselling Sessions'],
    'Electrical Services': ['Electricians'],
    'Event Services': ['Event Organisers'],
    'Financial Services': ['Insurance Agents'],
    'Fitness': ['Fitness Centres', 'Gyms', 'Get Your Own Trainer'],
    'Groceries & Supermarkets': ['Grocier & Supermarket', 'Grocery Stores'],
    'Healthcare': ['General'],
    'Home Design': [''],
    'Home Maintenance': ['Plumbers'],
    'Hotels & Hospitality': [''],
    'IT & Computer': ['It & Computer', 'Computer Repair & Services'],
    'Jewellery': ['Jewellery Showrooms', 'Gold Jewellery', 'Pearl Jewellery'],
    'Matrimony': ['Matrimonial Bureaus'],
    'Mobile Services': ['Mobile Phone Repair & Services', 'Mobile Phone Dealers'],
    'Packers & Movers': [''],
    'Pet Services': ['Pets Available'],
    'Pharmaceuticals & Chemists': ['Chemists'],
    'Placement & Recruitment': ['Placement & Recruitments', 'Placement Services (Candidate)'],
    'Printing & Publishing': ['Flex', 'Book', 'Digital'],
    'Real Estate': ['Estate Agents For Residential Rental', 'Real Estate Agents', 'Estate Agents For Residence', 'Estate Agents For Commercial Rental'],
    'Registration': [''],
    'Scrap': ['Battery Scrap', 'Scrap Dealers'],
    'Security Services': ['Bodyguard'],
    'Telecom & Internet Services': ['Internet Service Providers', 'Wifi Internet Service Providers'],
    'Transport': ['Transporters'],
    'Travel & Tourism': ['Travel Agents'],
    'Warehouse': ['Warehouses On Rent'],
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
async function resolveCategoryChain(categoryName) {
    const trimmed = categoryName.trim();
    if (!trimmed)
        return { leaf: trimmed, parent: null, root: trimmed, chain: [trimmed] };
    // Find the category node (case-insensitive)
    const node = await prisma_1.default.category.findFirst({
        where: { name: { equals: trimmed, mode: 'insensitive' }, is_active: true },
        select: { id: true, name: true, parent_id: true, level: true },
    });
    if (!node) {
        // Not in tree — return input as-is
        return { leaf: trimmed, parent: null, root: trimmed, chain: [trimmed] };
    }
    // Walk up the parent chain
    const names = [node.name];
    let currentParentId = node.parent_id;
    while (currentParentId !== null) {
        const parentNode = await prisma_1.default.category.findUnique({
            where: { id: currentParentId },
            select: { id: true, name: true, parent_id: true },
        });
        if (!parentNode)
            break;
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
async function buildCategoryMatchSet(categoryName) {
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
function parseCategoryStringBackend(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return [];
    if (trimmed.startsWith('Custom:')) {
        const custom = trimmed.slice('Custom:'.length).trim();
        return custom ? [custom] : [];
    }
    if (trimmed.includes('>')) {
        const [parentPart, ...rest] = trimmed.split('>');
        const parent = parentPart.trim();
        const subs = rest.join('>').split(',').map(s => s.trim()).filter(Boolean);
        const result = [];
        if (parent)
            result.push(parent);
        for (const sub of subs) {
            if (!result.includes(sub))
                result.push(sub);
        }
        return result;
    }
    return [trimmed];
}
async function listPromotions(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const listingType = typeof req.query.listing_type === 'string' ? req.query.listing_type.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    // Backward-compatible default: active + non-expired + pending payment
    const now = new Date();
    const where = {
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
        const promos = await prisma_1.default.businessPromotion.findMany({
            where: { user_id: 652 },
            select: { id: true, business_name: true, category: true },
        });
        console.log('[PROMO-CATEGORIES]', promos);
        // STEP 5 — CHECK MATCH MANUALLY
        for (const promo of promos) {
            console.log('[MATCH-CHECK]', {
                business: promo.business_name,
                categories: promo.category,
                intersects: promo.category.some((c) => matchSet.includes(c)),
            });
        }
    }
    if (listingType)
        where.listing_type = listingType;
    if (status) {
        delete where.OR;
        where.status = status;
    }
    // STEP 6 — PRINT FINAL QUERY WHERE
    console.log('[FINAL-WHERE]', JSON.stringify(where, null, 2));
    const promotions = await prisma_1.default.businessPromotion.findMany({
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
    const data = promotions.map((p) => {
        console.log('[PROMO-API] listPromotions', { id: p.id, tier: p.tier, status: p.status, payment_status: p.payment_status });
        return {
            ...p,
            effectiveTier: (0, tierFeatures_1.effectiveTier)(p.tier ?? 'free', p.status),
            is_premium: (p.tier ?? 'free') !== 'free' && p.status === 'active',
        };
    });
    res.json({ data, page, limit });
}
async function getPromotion(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const promo = await prisma_1.default.businessPromotion.findUnique({
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
    if (!promo) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    console.log('[PROMO-API] getPromotion', { id: promo.id, tier: promo.tier, status: promo.status, payment_status: promo.payment_status });
    res.json({ ...promo, effectiveTier: (0, tierFeatures_1.effectiveTier)(promo.tier ?? 'free', promo.status) });
}
async function createPromotion(req, res) {
    const userId = req.user.userId;
    const { business_name, owner_name, description, email, phone, whatsapp, website, business_hours, pincode, plot_no, building_name, street_name, landmark, area, city, state, category, business_card_id, listing_type, listing_intent, plan_type, } = req.body;
    // --- Category normalization ---
    // Accept string or string[]; parse "Parent > Sub1, Sub2" format; resolve full chain via tree
    const rawCategories = Array.isArray(category)
        ? category.map((s) => s.trim()).filter(Boolean)
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
    const result = await prisma_1.default.$transaction(async (tx) => {
        if (business_card_id) {
            const existing = await tx.businessPromotion.findFirst({
                where: { business_card_id, user_id: userId },
                orderBy: { created_at: 'desc' },
            });
            if (existing) {
                // Active or pending_payment — return existing, don't duplicate
                if (existing.status === 'active' || existing.status === 'pending_payment') {
                    return { created: false, promo: existing };
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
        return { created: true, promo };
    });
    if (result.created) {
        // Return fresh tokens with updated roles (includes new business role)
        const roles = (await prisma_1.default.userRole.findMany({ where: { user_id: userId } })).map(r => r.role);
        const accessToken = (0, jwt_1.signAccessToken)({ userId, roles });
        const refreshToken = (0, jwt_1.signRefreshToken)({ userId, roles });
        await prisma_1.default.refreshToken.create({
            data: { user_id: userId, token_hash: (0, jwt_1.hashToken)(refreshToken), expires_at: (0, jwt_1.refreshTokenExpiry)() },
        });
        (0, logger_1.logEvent)('PROMOTION_CREATED', { userId, promotionId: result.promo.id, plan_type: result.promo.plan_type });
        res.status(201).json({ ...result.promo, roles, accessToken, refreshToken });
    }
    else {
        res.status(200).json(result.promo);
    }
}
async function updatePromotion(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const promo = await prisma_1.default.businessPromotion.findUnique({ where: { id } });
    if (!promo) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    if (promo.user_id !== req.user.userId && !req.user.roles.includes('admin')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    // Whitelist only user-editable fields
    const allowed = [
        'business_name', 'owner_name', 'description', 'email', 'phone', 'whatsapp',
        'website', 'business_hours', 'pincode', 'plot_no', 'building_name', 'street_name',
        'landmark', 'area', 'city', 'state', 'category',
    ];
    const data = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined)
            data[key] = req.body[key];
    }
    // Normalize category through tree resolution if it was updated
    if (data.category !== undefined) {
        const rawCats = Array.isArray(data.category)
            ? data.category.map((s) => s.trim()).filter(Boolean)
            : typeof data.category === 'string' && data.category.trim()
                ? parseCategoryStringBackend(data.category.trim())
                : [];
        const resolvedSets = await Promise.all(rawCats.map(c => buildCategoryMatchSet(c)));
        data.category = [...new Set(resolvedSets.flat())];
    }
    const updated = await prisma_1.default.businessPromotion.update({ where: { id }, data });
    res.json(updated);
}
async function getMyPromotions(req, res) {
    const promotions = await prisma_1.default.businessPromotion.findMany({
        where: { user_id: req.user.userId },
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
    res.json(promotions.map((p) => {
        console.log('[PROMO-API] getMyPromotions', { id: p.id, tier: p.tier, status: p.status, payment_status: p.payment_status });
        return {
            ...p,
            effectiveTier: (0, tierFeatures_1.effectiveTier)(p.tier ?? 'free', p.status),
        };
    }));
}
/**
 * GET /promotions/pricing-plans
 * Returns all active pricing plans for premium listings.
 */
async function listPricingPlans(_req, res) {
    try {
        const plans = await prisma_1.default.promotionPricingPlan.findMany({
            where: { is_active: true },
            orderBy: { rank: 'asc' },
        });
        res.json(plans);
    }
    catch (err) {
        console.error('[PRICING-PLANS] Failed', err);
        res.status(500).json({ error: 'Failed to fetch pricing plans' });
    }
}
/**
 * POST /promotions/:id/payment-intent
 * Creates a Razorpay order for a promotion's premium plan.
 * Body: { pricing_plan_id: number }
 */
async function createPromotionPaymentIntent(req, res) {
    try {
        const promoId = (0, params_1.paramInt)(req.params.id);
        const { pricing_plan_id } = req.body;
        if (!pricing_plan_id) {
            res.status(400).json({ error: 'pricing_plan_id is required' });
            return;
        }
        const promo = await prisma_1.default.businessPromotion.findUnique({ where: { id: promoId } });
        if (!promo) {
            res.status(404).json({ error: 'Promotion not found' });
            return;
        }
        if (promo.user_id !== req.user.userId) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        const plan = await prisma_1.default.promotionPricingPlan.findUnique({ where: { id: pricing_plan_id } });
        if (!plan || !plan.is_active) {
            res.status(404).json({ error: 'Pricing plan not found or inactive' });
            return;
        }
        // Check for existing unpaid order and reuse it
        const existingOrder = await prisma_1.default.promotionOrder.findFirst({
            where: {
                business_promotion_id: promoId,
                pricing_plan_id: plan.id,
                status: 'created',
            },
        });
        if (existingOrder?.payment_order_id) {
            res.json({
                key: (0, razorpayService_1.getRazorpayPublicKey)(),
                order_id: existingOrder.payment_order_id,
                amount: Math.round(existingOrder.payable_amount * 100),
                currency: existingOrder.currency,
                promotion_order_id: existingOrder.id,
            });
            return;
        }
        const amountPaise = Math.round(plan.amount * 100);
        const razorpayOrder = await (0, razorpayService_1.createRazorpayOrder)({
            amountPaise,
            currency: plan.currency || 'INR',
            receipt: `promo_${promoId}_plan_${plan.id}`,
            notes: {
                promotion_id: String(promoId),
                plan_code: plan.code,
                user_id: String(req.user.userId),
            },
        });
        const order = await prisma_1.default.promotionOrder.create({
            data: {
                user_id: req.user.userId,
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
            key: (0, razorpayService_1.getRazorpayPublicKey)(),
            order_id: razorpayOrder.id,
            amount: amountPaise,
            currency: plan.currency || 'INR',
            promotion_order_id: order.id,
        });
    }
    catch (err) {
        console.error('[PROMO-PAYMENT] Failed', err);
        res.status(500).json({ error: 'Failed to create payment intent' });
    }
}
/**
 * POST /promotions/:id/verify-payment
 * Verifies Razorpay payment and activates the promotion plan.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
async function verifyPromotionPayment(req, res) {
    try {
        const promoId = (0, params_1.paramInt)(req.params.id);
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            res.status(400).json({ error: 'Payment verification fields are required' });
            return;
        }
        // Verify signature
        const isValid = (0, razorpayService_1.verifyRazorpaySignature)({
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
        const order = await prisma_1.default.promotionOrder.findFirst({
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
        if (order.user_id !== req.user.userId) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        const now = new Date();
        const expiresAt = new Date(now.getTime() + order.duration_days * 24 * 60 * 60 * 1000);
        const tier = (0, tierFeatures_1.rankLabelToTier)(order.rank_label);
        // Update order + promotion in a transaction
        const [updatedOrder, updatedPromo] = await prisma_1.default.$transaction([
            prisma_1.default.promotionOrder.update({
                where: { id: order.id },
                data: {
                    status: 'paid',
                    payment_id: razorpay_payment_id,
                    paid_at: now,
                    activated_at: now,
                    expires_at: expiresAt,
                },
            }),
            prisma_1.default.businessPromotion.update({
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
                    visibility_priority_score: (0, tierFeatures_1.tierToScore)(tier),
                },
            }),
        ]);
        // Grant business role (upsert to prevent duplicates)
        // BUSINESS RULE: The 'business' role is PERMANENT — never revoke on expiry.
        // Once granted through payment, a user remains a business user forever.
        await prisma_1.default.userRole.upsert({
            where: { user_id_role: { user_id: req.user.userId, role: 'business' } },
            update: {},
            create: { user_id: req.user.userId, role: 'business' },
        });
        console.log('[PROMO-VERIFY] Ensured business role for userId:', req.user.userId);
        // Return updated roles + fresh tokens so the client JWT reflects the new role
        const roles = (await prisma_1.default.userRole.findMany({
            where: { user_id: req.user.userId },
        })).map(r => r.role);
        const accessToken = (0, jwt_1.signAccessToken)({ userId: req.user.userId, roles });
        const refreshToken = (0, jwt_1.signRefreshToken)({ userId: req.user.userId, roles });
        await prisma_1.default.refreshToken.create({
            data: {
                user_id: req.user.userId,
                token_hash: (0, jwt_1.hashToken)(refreshToken),
                expires_at: (0, jwt_1.refreshTokenExpiry)(),
            },
        });
        (0, logger_1.logEvent)('PAYMENT_SUCCESS', {
            userId: req.user.userId,
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
    }
    catch (err) {
        console.error('[PROMO-VERIFY] Failed', err);
        res.status(500).json({ error: 'Payment verification failed' });
    }
}
/**
 * POST /promotions/:id/retry-payment
 * Allows retry for promotions stuck in pending_payment status.
 * Body: { pricing_plan_id: number }
 */
async function retryPromotionPayment(req, res) {
    try {
        const promoId = (0, params_1.paramInt)(req.params.id);
        const { pricing_plan_id } = req.body;
        if (!pricing_plan_id) {
            res.status(400).json({ error: 'pricing_plan_id is required' });
            return;
        }
        const promo = await prisma_1.default.businessPromotion.findUnique({ where: { id: promoId } });
        if (!promo) {
            res.status(404).json({ error: 'Promotion not found' });
            return;
        }
        if (promo.user_id !== req.user.userId) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        // Only allow retry for pending_payment promotions
        if (promo.status !== 'pending_payment') {
            res.status(409).json({ error: `Cannot retry payment — promotion status is '${promo.status}'` });
            return;
        }
        const plan = await prisma_1.default.promotionPricingPlan.findUnique({ where: { id: pricing_plan_id } });
        if (!plan || !plan.is_active) {
            res.status(404).json({ error: 'Pricing plan not found or inactive' });
            return;
        }
        const amountPaise = Math.round(plan.amount * 100);
        const razorpayOrder = await (0, razorpayService_1.createRazorpayOrder)({
            amountPaise,
            currency: plan.currency || 'INR',
            receipt: `promo_${promoId}_retry_${Date.now()}`,
            notes: {
                promotion_id: String(promoId),
                plan_code: plan.code,
                user_id: String(req.user.userId),
                retry: 'true',
            },
        });
        const order = await prisma_1.default.promotionOrder.create({
            data: {
                user_id: req.user.userId,
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
        (0, logger_1.logEvent)('PAYMENT_RETRY', { userId: req.user.userId, promotionId: promoId, orderId: order.id });
        res.json({
            key: (0, razorpayService_1.getRazorpayPublicKey)(),
            order_id: razorpayOrder.id,
            amount: amountPaise,
            currency: plan.currency || 'INR',
            promotion_order_id: order.id,
        });
    }
    catch (err) {
        console.error('[PROMO-RETRY] Failed', err);
        res.status(500).json({ error: 'Failed to create retry payment' });
    }
}
async function listPromotionsNearby(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = Math.min((0, params_1.queryInt)(req.query.limit, 20), 50);
    const search = (0, params_1.queryStr)(req.query.search)?.trim() || '';
    const category = (0, params_1.queryStr)(req.query.category)?.trim() || '';
    const listingType = (0, params_1.queryStr)(req.query.listing_type)?.trim() || '';
    const status = (0, params_1.queryStr)(req.query.status)?.trim() || '';
    const city = (0, params_1.queryStr)(req.query.city)?.trim() || '';
    const state = (0, params_1.queryStr)(req.query.state)?.trim() || '';
    const lat = (0, params_1.queryFloat)(req.query.lat, NaN);
    const lng = (0, params_1.queryFloat)(req.query.lng, NaN);
    const radiusMeters = (0, params_1.queryFloat)(req.query.radius, 5000);
    const radiusKm = radiusMeters / 1000;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    // Resolve category match set once (tree traversal + legacy map), reuse in both Prisma and raw SQL paths
    const categoryMatchValues = category ? await buildCategoryMatchSet(category) : [];
    const buildWhere = () => {
        const now = new Date();
        // Default: show active free + active non-expired premium + pending_payment (as free fallback)
        const where = {
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
        if (categoryMatchValues.length > 0)
            where.category = { hasSome: categoryMatchValues };
        if (listingType)
            where.listing_type = listingType;
        if (status) {
            delete where.OR;
            where.status = status;
        }
        if (city)
            where.city = { contains: city, mode: 'insensitive' };
        if (state)
            where.state = { contains: state, mode: 'insensitive' };
        return where;
    };
    if (!hasCoords) {
        const promotions = await prisma_1.default.businessPromotion.findMany({
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
        const data = promotions.map((p) => ({
            ...p,
            effectiveTier: (0, tierFeatures_1.effectiveTier)(p.tier, p.status),
            is_premium: p.tier !== 'free' && p.status === 'active',
        }));
        res.json({ data, page, limit });
        return;
    }
    const filters = [
        client_1.Prisma.sql `(
      (p."plan_type" = 'free' AND p."status" = 'active')
      OR (p."plan_type" = 'premium' AND p."status" = 'active' AND p."expiry_date" > NOW())
      OR (p."status" = 'pending_payment')
    )`,
    ];
    if (listingType)
        filters.push(client_1.Prisma.sql `p."listing_type" = ${listingType}`);
    if (status) {
        filters.length = 0;
        filters.push(client_1.Prisma.sql `p."status" = ${status}`);
    }
    if (categoryMatchValues.length > 0)
        filters.push(client_1.Prisma.sql `p."category" && ARRAY[${client_1.Prisma.join(categoryMatchValues)}]::text[]`);
    if (city)
        filters.push(client_1.Prisma.sql `p."city" ILIKE ${'%' + city + '%'}`);
    if (state)
        filters.push(client_1.Prisma.sql `p."state" ILIKE ${'%' + state + '%'}`);
    if (search) {
        const like = `%${search}%`;
        filters.push(client_1.Prisma.sql `(p."business_name" ILIKE ${like} OR p."owner_name" ILIKE ${like} OR p."city" ILIKE ${like} OR p."state" ILIKE ${like} OR p."area" ILIKE ${like} OR p."phone" ILIKE ${like} OR p."email" ILIKE ${like})`);
    }
    const whereSql = filters.length > 0 ? client_1.Prisma.sql `AND ${client_1.Prisma.join(filters, ' AND ')}` : client_1.Prisma.empty;
    const rows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
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
      ${client_1.Prisma.sql ` `}
      ${whereSql}
    ORDER BY p."visibility_priority_score" DESC, distance_km ASC, p."created_at" DESC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}
  `);
    if (rows.length === 0) {
        res.json({ data: [], page, limit });
        return;
    }
    const ids = rows.map((r) => r.id);
    const promos = await prisma_1.default.businessPromotion.findMany({
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
        const p = promoMap.get(row.id);
        return { ...p, distance_km: row.distance_km, effectiveTier: (0, tierFeatures_1.effectiveTier)(p.tier, p.status), is_premium: p.tier !== 'free' && p.status === 'active' };
    });
    res.json({ data, page, limit });
}
//# sourceMappingURL=promotionController.js.map