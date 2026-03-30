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