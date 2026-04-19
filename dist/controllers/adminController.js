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
exports.getAdCampaignDetails = getAdCampaignDetails;
exports.pauseAdCampaign = pauseAdCampaign;
exports.resumeAdCampaign = resumeAdCampaign;
exports.deleteAdCampaign = deleteAdCampaign;
exports.listUsers = listUsers;
exports.listBusinesses = listBusinesses;
exports.approveBusinessCard = approveBusinessCard;
exports.rejectBusinessCard = rejectBusinessCard;
exports.listEvents = listEvents;
exports.listVouchers = listVouchers;
exports.listReviews = listReviews;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const socketService_1 = require("../services/socketService");
const push_1 = require("../utils/push");
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
    try {
        const owner = await prisma_1.default.user.findUnique({ where: { id: promo.user_id }, select: { id: true, push_token: true } });
        if (owner) {
            const io = (0, socketService_1.getIO)();
            if (io)
                io.to(`user:${owner.id}`).emit('promotion:approved', { promotionId: id, title: promo.business_name });
            if (owner.push_token)
                (0, push_1.sendExpoPushNotification)(owner.push_token, 'Promotion Approved', `Your promotion "${promo.business_name}" has been approved!`, { screen: 'Promotions' });
        }
    }
    catch { /* non-blocking */ }
    res.json(promo);
}
async function rejectPromotion(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const { reason } = req.body;
    const promo = await prisma_1.default.businessPromotion.update({ where: { id }, data: { status: 'rejected' } });
    try {
        const owner = await prisma_1.default.user.findUnique({ where: { id: promo.user_id }, select: { id: true, push_token: true } });
        if (owner) {
            const io = (0, socketService_1.getIO)();
            if (io)
                io.to(`user:${owner.id}`).emit('promotion:rejected', { promotionId: id, title: promo.business_name, reason });
            if (owner.push_token)
                (0, push_1.sendExpoPushNotification)(owner.push_token, 'Promotion Rejected', `Your promotion "${promo.business_name}" was rejected${reason ? ': ' + reason : ''}`, { screen: 'Promotions' });
        }
    }
    catch { /* non-blocking */ }
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
    try {
        const owner = await prisma_1.default.user.findUnique({ where: { id: campaign.user_id }, select: { id: true, push_token: true } });
        if (owner) {
            const io = (0, socketService_1.getIO)();
            if (io)
                io.to(`user:${owner.id}`).emit('ad:approved', { campaignId: id, title: campaign.title });
            if (owner.push_token)
                (0, push_1.sendExpoPushNotification)(owner.push_token, 'Ad Campaign Approved', `Your ad "${campaign.title}" is now live!`, { screen: 'Ads' });
        }
    }
    catch { /* non-blocking */ }
    res.json(campaign);
}
async function rejectAdCampaign(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const campaign = await prisma_1.default.adCampaign.update({
        where: { id },
        data: { approval_status: 'rejected', status: 'paused' },
    });
    try {
        const owner = await prisma_1.default.user.findUnique({ where: { id: campaign.user_id }, select: { id: true, push_token: true } });
        if (owner) {
            const io = (0, socketService_1.getIO)();
            if (io)
                io.to(`user:${owner.id}`).emit('ad:rejected', { campaignId: id, title: campaign.title });
            if (owner.push_token)
                (0, push_1.sendExpoPushNotification)(owner.push_token, 'Ad Campaign Rejected', `Your ad "${campaign.title}" was not approved`, { screen: 'Ads' });
        }
    }
    catch { /* non-blocking */ }
    res.json(campaign);
}
async function getAdCampaignDetails(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        console.log('[getAdCampaignDetails] Fetching campaign:', id);
        const campaign = await prisma_1.default.adCampaign.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, name: true, phone: true, email: true } },
                business: { select: { id: true, company_name: true, logo_url: true } },
                variants: {
                    select: { id: true, creative_url: true, label: true, impressions: true, clicks: true },
                },
            },
        });
        if (!campaign) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        console.log('[getAdCampaignDetails] ✅ Found campaign:', campaign.title);
        res.json(campaign);
    }
    catch (err) {
        console.error('[getAdCampaignDetails] ❌ Error:', err);
        res.status(500).json({ error: 'Failed to fetch campaign details' });
    }
}
async function pauseAdCampaign(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        console.log('[pauseAdCampaign] Pausing campaign:', id);
        const campaign = await prisma_1.default.adCampaign.update({
            where: { id },
            data: { status: 'paused' },
            include: { user: { select: { id: true, name: true, phone: true } } },
        });
        console.log('[pauseAdCampaign] ✅ Campaign paused:', campaign.title);
        res.json({ message: 'Campaign paused', campaign });
    }
    catch (err) {
        console.error('[pauseAdCampaign] ❌ Error:', err);
        res.status(500).json({ error: 'Failed to pause campaign' });
    }
}
async function resumeAdCampaign(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        console.log('[resumeAdCampaign] Resuming campaign:', id);
        const campaign = await prisma_1.default.adCampaign.update({
            where: { id },
            data: { status: 'active' },
            include: { user: { select: { id: true, name: true, phone: true } } },
        });
        console.log('[resumeAdCampaign] ✅ Campaign resumed:', campaign.title);
        res.json({ message: 'Campaign resumed', campaign });
    }
    catch (err) {
        console.error('[resumeAdCampaign] ❌ Error:', err);
        res.status(500).json({ error: 'Failed to resume campaign' });
    }
}
async function deleteAdCampaign(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        console.log('[deleteAdCampaign] Deleting campaign:', id);
        // Check if campaign exists
        const campaign = await prisma_1.default.adCampaign.findUnique({ where: { id } });
        if (!campaign) {
            console.log('[deleteAdCampaign] ❌ Campaign not found:', id);
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        // Delete variants first
        const deletedVariants = await prisma_1.default.adVariant.deleteMany({ where: { campaign_id: id } });
        console.log('[deleteAdCampaign] Deleted variants:', deletedVariants.count);
        // Delete campaign
        await prisma_1.default.adCampaign.delete({ where: { id } });
        console.log('[deleteAdCampaign] ✅ Campaign deleted:', campaign.title);
        res.json({ message: 'Campaign deleted successfully', campaign_id: id, title: campaign.title });
    }
    catch (err) {
        console.error('[deleteAdCampaign] ❌ Error:', err.message, err.code);
        res.status(500).json({ error: err.message || 'Failed to delete campaign' });
    }
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
    const card = await prisma_1.default.businessCard.findUnique({ where: { id } });
    if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    const updated = await prisma_1.default.businessCard.update({
        where: { id },
        data: { approval_status: 'approved' },
    });
    // Grant business role to card owner if they don't already have it
    const existingRole = await prisma_1.default.userRole.findFirst({
        where: { user_id: card.user_id, role: 'business' },
    });
    if (!existingRole) {
        await prisma_1.default.userRole.create({ data: { user_id: card.user_id, role: 'business' } });
    }
    // Notify card owner
    try {
        const owner = await prisma_1.default.user.findUnique({ where: { id: card.user_id }, select: { id: true, push_token: true } });
        if (owner) {
            const io = (0, socketService_1.getIO)();
            if (io)
                io.to(`user:${owner.id}`).emit('card:approved', { cardId: id, cardName: updated.company_name || updated.full_name });
            if (owner.push_token)
                (0, push_1.sendExpoPushNotification)(owner.push_token, 'Business Card Approved', `Your business card "${updated.company_name || updated.full_name}" has been approved!`, { screen: 'MyCards' });
        }
    }
    catch { /* non-blocking */ }
    res.json(updated);
}
async function rejectBusinessCard(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const card = await prisma_1.default.businessCard.update({
        where: { id },
        data: { approval_status: 'rejected' },
    });
    // Notify card owner
    try {
        const owner = await prisma_1.default.user.findUnique({ where: { id: card.user_id }, select: { id: true, push_token: true } });
        if (owner) {
            const io = (0, socketService_1.getIO)();
            if (io)
                io.to(`user:${owner.id}`).emit('card:rejected', { cardId: id, cardName: card.company_name || card.full_name });
            if (owner.push_token)
                (0, push_1.sendExpoPushNotification)(owner.push_token, 'Business Card Rejected', `Your business card "${card.company_name || card.full_name}" was not approved`, { screen: 'MyCards' });
        }
    }
    catch { /* non-blocking */ }
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