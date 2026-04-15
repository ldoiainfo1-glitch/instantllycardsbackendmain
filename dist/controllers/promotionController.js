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
async function listPromotions(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const listingType = typeof req.query.listing_type === 'string' ? req.query.listing_type.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    // Default: show active free + active non-expired premium + pending_payment (as free fallback)
    const now = new Date();
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
    if (category)
        where.category = { has: category };
    if (listingType)
        where.listing_type = listingType;
    if (status) {
        delete where.OR;
        where.status = status;
    }
    const promotions = await prisma_1.default.businessPromotion.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ visibility_priority_score: 'desc' }, { created_at: 'desc' }],
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
            plan_type: true,
            tier: true,
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
            plan_type: true,
            tier: true,
            status: true,
            expiry_date: true,
            visibility_priority_score: true,
            business_card: true,
            user: { select: { id: true, name: true } },
        },
    });
    if (!promo) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json({ ...promo, effectiveTier: (0, tierFeatures_1.effectiveTier)(promo.tier, promo.status) });
}
async function createPromotion(req, res) {
    const userId = req.user.userId;
    const { business_name, owner_name, description, email, phone, whatsapp, website, business_hours, pincode, plot_no, building_name, street_name, landmark, area, city, state, category, business_card_id, listing_type, listing_intent, plan_type, } = req.body;
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
                category: Array.isArray(category) ? category : (category ? [category] : []),
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
    const updated = await prisma_1.default.businessPromotion.update({ where: { id }, data });
    res.json(updated);
}
async function getMyPromotions(req, res) {
    const promotions = await prisma_1.default.businessPromotion.findMany({
        where: { user_id: req.user.userId },
        orderBy: { created_at: 'desc' },
    });
    res.json(promotions.map((p) => ({
        ...p,
        effectiveTier: (0, tierFeatures_1.effectiveTier)(p.tier, p.status),
    })));
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
        if (category)
            where.category = { has: category };
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
    if (category)
        filters.push(client_1.Prisma.sql `p."category" && ARRAY[${category}]::text[]`);
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