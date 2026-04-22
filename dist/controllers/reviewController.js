"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCardReviews = getCardReviews;
exports.getPromotionReviews = getPromotionReviews;
exports.createReview = createReview;
exports.createFeedback = createFeedback;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
async function getCardReviews(req, res) {
    const cardId = (0, params_1.paramInt)(req.params.cardId);
    const reviews = await prisma_1.default.review.findMany({
        where: { business_id: cardId },
        include: { user: { select: { id: true, name: true, profile_picture: true } } },
        orderBy: { created_at: 'desc' },
    });
    res.json(reviews);
}
async function getPromotionReviews(req, res) {
    const promotionId = (0, params_1.paramInt)(req.params.promotionId);
    const promo = await prisma_1.default.businessPromotion.findUnique({
        where: { id: promotionId },
        select: { id: true, business_card_id: true },
    });
    if (!promo) {
        res.status(404).json({ error: 'Promotion not found' });
        return;
    }
    const scope = [{ business_promotion_id: promotionId }];
    if (promo.business_card_id)
        scope.push({ business_id: promo.business_card_id });
    const reviews = await prisma_1.default.review.findMany({
        where: { OR: scope },
        include: { user: { select: { id: true, name: true, profile_picture: true } } },
        orderBy: { created_at: 'desc' },
    });
    res.json(reviews);
}
async function createReview(req, res) {
    const { business_id, business_promotion_id, rating, comment, photo_url } = req.body;
    let resolvedBusinessId = business_id ? parseInt(business_id, 10) : null;
    let resolvedPromotionId = business_promotion_id ? parseInt(business_promotion_id, 10) : null;
    if (!resolvedBusinessId && !resolvedPromotionId) {
        res.status(400).json({ error: 'business_id or business_promotion_id is required' });
        return;
    }
    if (resolvedPromotionId && !resolvedBusinessId) {
        const promo = await prisma_1.default.businessPromotion.findUnique({
            where: { id: resolvedPromotionId },
            select: { business_card_id: true },
        });
        if (promo?.business_card_id)
            resolvedBusinessId = promo.business_card_id;
    }
    const dedupeScope = [];
    if (resolvedBusinessId)
        dedupeScope.push({ business_id: resolvedBusinessId });
    if (resolvedPromotionId)
        dedupeScope.push({ business_promotion_id: resolvedPromotionId });
    const existing = await prisma_1.default.review.findFirst({
        where: { user_id: req.user.userId, OR: dedupeScope },
    });
    if (existing) {
        res.status(409).json({ error: 'Already reviewed' });
        return;
    }
    const review = await prisma_1.default.review.create({
        data: {
            business_id: resolvedBusinessId,
            business_promotion_id: resolvedPromotionId,
            user_id: req.user.userId,
            rating: parseInt(rating),
            comment: comment || null,
            photo_url: photo_url || null,
        },
    });
    res.status(201).json(review);
}
async function createFeedback(req, res) {
    const { name, phone, subject, message, rating } = req.body;
    const user = await prisma_1.default.user.findUnique({ where: { id: req.user.userId } });
    const feedback = await prisma_1.default.feedback.create({
        data: {
            user_id: req.user.userId,
            name: name || user?.name || 'Unknown',
            phone: phone || user?.phone || '',
            subject: subject || 'General',
            message,
            rating: rating ? parseInt(rating) : null,
        },
    });
    res.status(201).json(feedback);
}
//# sourceMappingURL=reviewController.js.map