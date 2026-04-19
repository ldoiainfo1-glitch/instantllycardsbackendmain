"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCardReviews = getCardReviews;
exports.createReview = createReview;
exports.createFeedback = createFeedback;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const socketService_1 = require("../services/socketService");
const push_1 = require("../utils/push");
async function getCardReviews(req, res) {
    const cardId = (0, params_1.paramInt)(req.params.cardId);
    const reviews = await prisma_1.default.review.findMany({
        where: { business_id: cardId },
        include: { user: { select: { id: true, name: true, profile_picture: true } } },
        orderBy: { created_at: 'desc' },
    });
    res.json(reviews);
}
async function createReview(req, res) {
    const { business_id, rating, comment, photo_url } = req.body;
    const existing = await prisma_1.default.review.findFirst({
        where: { business_id: parseInt(business_id), user_id: req.user.userId },
    });
    if (existing) {
        res.status(409).json({ error: 'Already reviewed' });
        return;
    }
    const review = await prisma_1.default.review.create({
        data: {
            business_id: parseInt(business_id),
            user_id: req.user.userId,
            rating: parseInt(rating),
            comment: comment || null,
            photo_url: photo_url || null,
        },
    });
    // Notify business card owner about the new review
    try {
        const card = await prisma_1.default.businessCard.findUnique({ where: { id: parseInt(business_id) }, select: { user_id: true, company_name: true, full_name: true } });
        if (card) {
            const owner = await prisma_1.default.user.findUnique({ where: { id: card.user_id }, select: { id: true, push_token: true } });
            const reviewer = await prisma_1.default.user.findUnique({ where: { id: req.user.userId }, select: { name: true } });
            if (owner && owner.id !== req.user.userId) {
                const io = (0, socketService_1.getIO)();
                const payload = { type: 'review:created', reviewId: review.id, businessId: parseInt(business_id), rating: parseInt(rating), reviewerName: reviewer?.name ?? 'Someone' };
                if (io)
                    io.to(`user:${owner.id}`).emit('review:created', payload);
                if (owner.push_token) {
                    (0, push_1.sendExpoPushNotification)(owner.push_token, 'New Review', `${reviewer?.name ?? 'Someone'} left a ${rating}-star review on ${card.company_name || card.full_name}`, { screen: 'Reviews' });
                }
            }
        }
    }
    catch { /* non-blocking */ }
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