"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardCounts = getDashboardCounts;
exports.getPendingPromotions = getPendingPromotions;
exports.approvePromotion = approvePromotion;
exports.rejectPromotion = rejectPromotion;
exports.listAdCampaigns = listAdCampaigns;
exports.approveAdCampaign = approveAdCampaign;
exports.rejectAdCampaign = rejectAdCampaign;
exports.listUsers = listUsers;
exports.listBusinesses = listBusinesses;
exports.approveBusinessCard = approveBusinessCard;
exports.rejectBusinessCard = rejectBusinessCard;
exports.listEvents = listEvents;
exports.listVouchers = listVouchers;
exports.listReviews = listReviews;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
async function getDashboardCounts(_req, res) {
    const [users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads, adCampaigns, bookings, events] = await Promise.all([
        prisma_1.default.user.count(),
        prisma_1.default.businessCard.count(),
        prisma_1.default.businessPromotion.count(),
        prisma_1.default.voucher.count(),
        prisma_1.default.category.count(),
        prisma_1.default.review.count(),
        prisma_1.default.feedback.count(),
        prisma_1.default.ad.count(),
        prisma_1.default.adCampaign.count(),
        prisma_1.default.booking.count(),
        prisma_1.default.event.count(),
    ]);
    res.json({ users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads, adCampaigns, bookings, events });
}
// ─── Promotions ──────────────────────────────────────────────────────────────
async function getPendingPromotions(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const promotions = await prisma_1.default.businessPromotion.findMany({
        where: { status: 'pending' },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, name: true, phone: true } } },
    });
    res.json({ data: promotions, page, limit });
}
async function approvePromotion(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const promo = await prisma_1.default.businessPromotion.update({ where: { id }, data: { status: 'active' } });
    res.json(promo);
}
async function rejectPromotion(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const { reason } = req.body;
    const promo = await prisma_1.default.businessPromotion.update({ where: { id }, data: { status: 'rejected' } });
    res.json({ ...promo, rejection_reason: reason });
}
// ─── Ad campaign management ─────────────────────────────────────────────────
async function listAdCampaigns(req, res) {
    const status = req.query.approval_status;
    // Auto-pause expired ads
    await prisma_1.default.adCampaign.updateMany({
        where: {
            status: 'active',
            end_date: { lt: new Date() }
        },
        data: { status: 'completed' }
    });
    const where = {};
    if (status && status !== 'all')
        where.approval_status = status;
    const campaigns = await prisma_1.default.adCampaign.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: {
            user: { select: { id: true, name: true, phone: true } },
            business: { select: { id: true, company_name: true, logo_url: true } },
        },
        take: 200,
    });
    res.json(campaigns);
}
async function approveAdCampaign(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const campaign = await prisma_1.default.adCampaign.update({
        where: { id },
        data: { approval_status: 'approved', status: 'active' },
    });
    res.json(campaign);
}
async function rejectAdCampaign(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const campaign = await prisma_1.default.adCampaign.update({
        where: { id },
        data: { approval_status: 'rejected', status: 'paused' },
    });
    res.json(campaign);
}
// ─── Listing endpoints ──────────────────────────────────────────────────────
async function listUsers(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 50);
    const users = await prisma_1.default.user.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
            id: true, name: true, phone: true, email: true,
            profile_picture: true, created_at: true,
            user_roles: true,
        },
    });
    res.json({ data: users, page, limit });
}
async function listBusinesses(req, res) {
    const status = req.query.approval_status;
    const where = {};
    if (status && status !== 'all')
        where.approval_status = status;
    const cards = await prisma_1.default.businessCard.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: 200,
        include: { user: { select: { id: true, name: true, phone: true } } },
    });
    res.json(cards);
}
async function approveBusinessCard(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const card = await prisma_1.default.businessCard.update({
        where: { id },
        data: { approval_status: 'approved' },
    });
    res.json(card);
}
async function rejectBusinessCard(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const card = await prisma_1.default.businessCard.update({
        where: { id },
        data: { approval_status: 'rejected' },
    });
    res.json(card);
}
async function listEvents(_req, res) {
    const events = await prisma_1.default.event.findMany({
        orderBy: { created_at: 'desc' },
        take: 200,
    });
    res.json(events);
}
async function listVouchers(_req, res) {
    const vouchers = await prisma_1.default.voucher.findMany({
        orderBy: { created_at: 'desc' },
        take: 200,
    });
    res.json(vouchers);
}
async function listReviews(_req, res) {
    const reviews = await prisma_1.default.review.findMany({
        orderBy: { created_at: 'desc' },
        take: 200,
        include: { user: { select: { id: true, name: true } } },
    });
    res.json(reviews);
}
//# sourceMappingURL=adminController.js.map