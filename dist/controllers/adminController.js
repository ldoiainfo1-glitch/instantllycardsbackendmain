"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardCounts = getDashboardCounts;
exports.getPendingPromotions = getPendingPromotions;
exports.approvePromotion = approvePromotion;
exports.rejectPromotion = rejectPromotion;
exports.listUsers = listUsers;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
async function getDashboardCounts(_req, res) {
    const [users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads] = await Promise.all([
        prisma_1.default.user.count(),
        prisma_1.default.businessCard.count(),
        prisma_1.default.businessPromotion.count(),
        prisma_1.default.voucher.count(),
        prisma_1.default.category.count(),
        prisma_1.default.review.count(),
        prisma_1.default.feedback.count(),
        prisma_1.default.ad.count(),
    ]);
    res.json({ users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads });
}
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
//# sourceMappingURL=adminController.js.map