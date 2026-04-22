"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMyBookings = listMyBookings;
exports.listBusinessBookings = listBusinessBookings;
exports.listPromotionBookings = listPromotionBookings;
exports.getBooking = getBooking;
exports.createBooking = createBooking;
exports.updateBookingStatus = updateBookingStatus;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
async function listMyBookings(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const bookings = await prisma_1.default.booking.findMany({
        where: { user_id: req.user.userId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { business: { select: { id: true, company_name: true, logo_url: true, full_name: true } } },
    });
    res.json({ data: bookings, page, limit });
}
async function listBusinessBookings(req, res) {
    const businessId = (0, params_1.paramInt)(req.params.businessId);
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const status = req.query.status;
    const promotionId = (0, params_1.queryInt)(req.query.promotion_id, 0) || undefined;
    const card = await prisma_1.default.businessCard.findUnique({ where: { id: businessId } });
    if (!card) {
        res.status(404).json({ error: 'Business not found' });
        return;
    }
    if (card.user_id !== req.user.userId && !req.user.roles.includes('admin')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const scope = [{ business_id: businessId }];
    if (promotionId)
        scope.push({ business_promotion_id: promotionId });
    const where = { OR: scope };
    if (status)
        where.status = status;
    const bookings = await prisma_1.default.booking.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
    });
    res.json({ data: bookings, page, limit });
}
async function listPromotionBookings(req, res) {
    const promotionId = (0, params_1.paramInt)(req.params.promotionId);
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const status = req.query.status;
    const promotion = await prisma_1.default.businessPromotion.findUnique({ where: { id: promotionId } });
    if (!promotion) {
        res.status(404).json({ error: 'Promotion not found' });
        return;
    }
    if (promotion.user_id !== req.user.userId && !req.user.roles.includes('admin')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const scope = [{ business_promotion_id: promotionId }];
    if (promotion.business_card_id)
        scope.push({ business_id: promotion.business_card_id });
    const where = { OR: scope };
    if (status)
        where.status = status;
    const bookings = await prisma_1.default.booking.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
    });
    res.json({ data: bookings, page, limit });
}
async function getBooking(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const booking = await prisma_1.default.booking.findUnique({
        where: { id },
        include: {
            business: { select: { id: true, user_id: true, company_name: true, logo_url: true, full_name: true, phone: true } },
            business_promotion: { select: { id: true, user_id: true, business_name: true } },
            user: { select: { id: true, name: true, phone: true, profile_picture: true } },
        },
    });
    if (!booking) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const userId = req.user.userId;
    const isOwner = booking.user_id === userId;
    const isBusinessOwner = booking.business?.user_id === userId || booking.business_promotion?.user_id === userId;
    const isAdmin = req.user.roles.includes('admin');
    if (!isOwner && !isBusinessOwner && !isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    res.json(booking);
}
async function createBooking(req, res) {
    const { business_id, business_promotion_id, business_name, mode, booking_date, booking_time, customer_name, customer_phone, notes, } = req.body;
    let resolvedBusinessId = business_id ? parseInt(business_id, 10) : null;
    let resolvedPromotionId = business_promotion_id ? parseInt(business_promotion_id, 10) : null;
    let resolvedName = business_name;
    if (!resolvedBusinessId && !resolvedPromotionId) {
        res.status(400).json({ error: 'business_id or business_promotion_id is required' });
        return;
    }
    if (resolvedPromotionId) {
        const promo = await prisma_1.default.businessPromotion.findUnique({ where: { id: resolvedPromotionId } });
        if (!promo) {
            res.status(404).json({ error: 'Promotion not found' });
            return;
        }
        if (!resolvedBusinessId && promo.business_card_id)
            resolvedBusinessId = promo.business_card_id;
        if (!resolvedName)
            resolvedName = promo.business_name;
    }
    if (resolvedBusinessId) {
        const card = await prisma_1.default.businessCard.findUnique({ where: { id: resolvedBusinessId } });
        if (!card) {
            res.status(404).json({ error: 'Business not found' });
            return;
        }
        if (!resolvedName)
            resolvedName = card.company_name || card.full_name;
    }
    const booking = await prisma_1.default.booking.create({
        data: {
            user_id: req.user.userId,
            business_id: resolvedBusinessId,
            business_promotion_id: resolvedPromotionId,
            business_name: resolvedName || 'Business',
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
async function updateBookingStatus(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        return;
    }
    const booking = await prisma_1.default.booking.findUnique({
        where: { id },
        include: { business: { select: { user_id: true } }, business_promotion: { select: { user_id: true } } },
    });
    if (!booking) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const userId = req.user.userId;
    const isCustomer = booking.user_id === userId;
    const isBusinessOwner = booking.business?.user_id === userId || booking.business_promotion?.user_id === userId;
    const isAdmin = req.user.roles.includes('admin');
    if (status === 'cancelled' && !isCustomer && !isBusinessOwner && !isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    if ((status === 'confirmed' || status === 'completed') && !isBusinessOwner && !isAdmin) {
        res.status(403).json({ error: 'Only the business owner can confirm/complete bookings' });
        return;
    }
    const updated = await prisma_1.default.booking.update({ where: { id }, data: { status } });
    res.json(updated);
}
//# sourceMappingURL=bookingController.js.map