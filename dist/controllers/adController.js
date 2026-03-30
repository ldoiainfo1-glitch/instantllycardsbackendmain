"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAds = listAds;
exports.getMyCampaigns = getMyCampaigns;
exports.getCampaign = getCampaign;
exports.createCampaign = createCampaign;
exports.updateCampaign = updateCampaign;
exports.deleteCampaign = deleteCampaign;
exports.trackImpression = trackImpression;
exports.trackClick = trackClick;
exports.getCampaignAnalytics = getCampaignAnalytics;
exports.getCampaignVariants = getCampaignVariants;
exports.listLegacyAds = listLegacyAds;
exports.getMyAds = getMyAds;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const params_2 = require("../utils/params");
// ─── Helpers ────────────────────────────────────────────────────────────────
const CAMPAIGN_FIELDS = [
    'title', 'description', 'ad_type', 'cta', 'creative_url', 'creative_urls',
    'target_city', 'target_age', 'target_interests', 'daily_budget',
    'duration_days', 'business_card_id',
];
function pickCampaignFields(body) {
    const out = {};
    for (const key of CAMPAIGN_FIELDS) {
        if (body[key] !== undefined)
            out[key] = body[key];
    }
    return out;
}
// ─── List active campaigns (public delivery endpoint) ───────────────────────
async function listAds(req, res) {
    try {
        const adType = (0, params_2.queryStr)(req.query.ad_type);
        const city = (0, params_2.queryStr)(req.query.city);
        const limit = (0, params_2.queryInt)(req.query.limit, 50);
        const where = {
            status: 'active',
            approval_status: 'approved',
            OR: [
                { end_date: null },
                { end_date: { gte: new Date() } },
            ],
        };
        if (adType)
            where.ad_type = adType;
        if (city)
            where.target_city = { contains: city, mode: 'insensitive' };
        const campaigns = await prisma_1.default.adCampaign.findMany({
            where,
            orderBy: [{ daily_budget: 'desc' }, { created_at: 'desc' }],
            include: { business: { select: { id: true, company_name: true, logo_url: true } } },
            take: limit,
        });
        res.json(campaigns);
    }
    catch (err) {
        console.error('[listAds] error:', err);
        res.status(500).json({ error: 'Failed to list ads' });
    }
}
// ─── Get my campaigns ───────────────────────────────────────────────────────
async function getMyCampaigns(req, res) {
    try {
        const campaigns = await prisma_1.default.adCampaign.findMany({
            where: { user_id: req.user.userId },
            include: {
                business: { select: { id: true, company_name: true, logo_url: true } },
                variants: true,
            },
            orderBy: { created_at: 'desc' },
        });
        res.json(campaigns);
    }
    catch (err) {
        console.error('[getMyCampaigns] error:', err);
        res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
}
// ─── Get single campaign ────────────────────────────────────────────────────
async function getCampaign(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const campaign = await prisma_1.default.adCampaign.findUnique({
            where: { id },
            include: {
                business: { select: { id: true, company_name: true, logo_url: true } },
                variants: true,
            },
        });
        if (!campaign) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        res.json(campaign);
    }
    catch (err) {
        console.error('[getCampaign] error:', err);
        res.status(500).json({ error: 'Failed to fetch campaign' });
    }
}
// ─── Create campaign ────────────────────────────────────────────────────────
async function createCampaign(req, res) {
    try {
        const fields = pickCampaignFields(req.body);
        if (!fields.title) {
            res.status(422).json({ error: 'title is required' });
            return;
        }
        if (!fields.ad_type) {
            res.status(422).json({ error: 'ad_type is required' });
            return;
        }
        const dailyBudget = fields.daily_budget || 100;
        const durationDays = fields.duration_days || 7;
        const totalBudget = dailyBudget * durationDays;
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + durationDays);
        const campaign = await prisma_1.default.adCampaign.create({
            data: {
                user_id: req.user.userId,
                title: fields.title,
                description: fields.description || null,
                ad_type: fields.ad_type,
                cta: fields.cta || null,
                creative_url: fields.creative_url || null,
                creative_urls: fields.creative_urls || [],
                target_city: fields.target_city || null,
                target_age: fields.target_age || null,
                target_interests: fields.target_interests || null,
                daily_budget: dailyBudget,
                duration_days: durationDays,
                total_budget: totalBudget,
                business_card_id: fields.business_card_id ? parseInt(String(fields.business_card_id), 10) : null,
                end_date: endDate,
                status: 'active',
                approval_status: 'pending',
            },
            include: { variants: true },
        });
        // Create A/B variants if multiple creatives provided
        const urls = fields.creative_urls || [];
        if (urls.length > 1) {
            const variants = urls.map((url, i) => ({
                campaign_id: campaign.id,
                creative_url: url,
                label: String.fromCharCode(65 + i),
            }));
            await prisma_1.default.adVariant.createMany({ data: variants });
        }
        const result = await prisma_1.default.adCampaign.findUnique({
            where: { id: campaign.id },
            include: { variants: true },
        });
        res.status(201).json(result);
    }
    catch (err) {
        console.error('[createCampaign] error:', err);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
}
// ─── Update campaign ────────────────────────────────────────────────────────
async function updateCampaign(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const existing = await prisma_1.default.adCampaign.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        // Only owner or admin can update
        const roles = await prisma_1.default.userRole.findMany({ where: { user_id: req.user.userId } });
        const isAdmin = roles.some((r) => r.role === 'admin');
        if (existing.user_id !== req.user.userId && !isAdmin) {
            res.status(403).json({ error: 'Not authorized' });
            return;
        }
        const allowed = ['title', 'description', 'cta', 'target_city', 'target_age', 'target_interests', 'status', 'daily_budget', 'duration_days'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined)
                updates[key] = req.body[key];
        }
        // Recalculate total_budget if budget/duration changed
        if (updates.daily_budget || updates.duration_days) {
            const db = updates.daily_budget || existing.daily_budget;
            const dd = updates.duration_days || existing.duration_days;
            updates.total_budget = db * dd;
        }
        const campaign = await prisma_1.default.adCampaign.update({
            where: { id },
            data: updates,
            include: { variants: true },
        });
        res.json(campaign);
    }
    catch (err) {
        console.error('[updateCampaign] error:', err);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
}
// ─── Delete campaign ────────────────────────────────────────────────────────
async function deleteCampaign(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const existing = await prisma_1.default.adCampaign.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        const roles = await prisma_1.default.userRole.findMany({ where: { user_id: req.user.userId } });
        const isAdmin = roles.some((r) => r.role === 'admin');
        if (existing.user_id !== req.user.userId && !isAdmin) {
            res.status(403).json({ error: 'Not authorized' });
            return;
        }
        await prisma_1.default.adCampaign.delete({ where: { id } });
        res.json({ ok: true });
    }
    catch (err) {
        console.error('[deleteCampaign] error:', err);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
}
// ─── Track impression ───────────────────────────────────────────────────────
async function trackImpression(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const variantId = req.body.variant_id ? parseInt(String(req.body.variant_id), 10) : undefined;
        const campaign = await prisma_1.default.adCampaign.findUnique({ where: { id } });
        if (!campaign) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        // Deduct from budget (CPM model: cost per 1000 impressions)
        const cpmRate = campaign.daily_budget / 1000; // simplified
        const txns = [
            prisma_1.default.adCampaign.update({
                where: { id },
                data: {
                    impressions: { increment: 1 },
                    spent: { increment: cpmRate },
                },
            }),
        ];
        if (variantId) {
            txns.push(prisma_1.default.adVariant.update({
                where: { id: variantId },
                data: { impressions: { increment: 1 } },
            }));
        }
        await prisma_1.default.$transaction(txns);
        // Pause campaign if budget exhausted
        if (campaign.total_budget && campaign.spent + cpmRate >= campaign.total_budget) {
            await prisma_1.default.adCampaign.update({
                where: { id },
                data: { status: 'completed' },
            });
        }
        res.json({ ok: true });
    }
    catch (err) {
        console.error('[trackImpression] error:', err);
        res.status(500).json({ error: 'Failed to track impression' });
    }
}
// ─── Track click ────────────────────────────────────────────────────────────
async function trackClick(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const variantId = req.body.variant_id ? parseInt(String(req.body.variant_id), 10) : undefined;
        const txns = [
            prisma_1.default.adCampaign.update({
                where: { id },
                data: { clicks: { increment: 1 } },
            }),
        ];
        if (variantId) {
            txns.push(prisma_1.default.adVariant.update({
                where: { id: variantId },
                data: { clicks: { increment: 1 } },
            }));
        }
        await prisma_1.default.$transaction(txns);
        res.json({ ok: true });
    }
    catch (err) {
        console.error('[trackClick] error:', err);
        res.status(500).json({ error: 'Failed to track click' });
    }
}
// ─── Campaign analytics ─────────────────────────────────────────────────────
async function getCampaignAnalytics(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const campaign = await prisma_1.default.adCampaign.findUnique({
            where: { id },
            include: { variants: true },
        });
        if (!campaign) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        if (campaign.user_id !== req.user.userId) {
            res.status(403).json({ error: 'Not authorized' });
            return;
        }
        const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
        const cpc = campaign.clicks > 0 ? campaign.spent / campaign.clicks : 0;
        const budgetUsed = campaign.total_budget ? (campaign.spent / campaign.total_budget) * 100 : 0;
        res.json({
            campaign,
            analytics: {
                impressions: campaign.impressions,
                clicks: campaign.clicks,
                ctr: parseFloat(ctr.toFixed(2)),
                cpc: parseFloat(cpc.toFixed(2)),
                spent: campaign.spent,
                total_budget: campaign.total_budget,
                budget_used_pct: parseFloat(budgetUsed.toFixed(1)),
                variants: campaign.variants.map((v) => ({
                    id: v.id,
                    label: v.label,
                    creative_url: v.creative_url,
                    impressions: v.impressions,
                    clicks: v.clicks,
                    ctr: v.impressions > 0 ? parseFloat(((v.clicks / v.impressions) * 100).toFixed(2)) : 0,
                })),
            },
        });
    }
    catch (err) {
        console.error('[getCampaignAnalytics] error:', err);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
}
// ─── Get variants for a campaign ────────────────────────────────────────────
async function getCampaignVariants(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const variants = await prisma_1.default.adVariant.findMany({
            where: { campaign_id: id },
            orderBy: { label: 'asc' },
        });
        res.json(variants);
    }
    catch (err) {
        console.error('[getCampaignVariants] error:', err);
        res.status(500).json({ error: 'Failed to fetch variants' });
    }
}
// ─── Legacy: list old Ad model (for backward compat) ────────────────────────
async function listLegacyAds(_req, res) {
    try {
        const ads = await prisma_1.default.ad.findMany({
            where: { status: 'active' },
            orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
            include: { business: { select: { id: true, company_name: true, logo_url: true } } },
            take: 50,
        });
        res.json(ads);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to list ads' });
    }
}
async function getMyAds(req, res) {
    try {
        const cards = await prisma_1.default.businessCard.findMany({
            where: { user_id: req.user.userId },
            select: { id: true },
        });
        const cardIds = cards.map((c) => c.id);
        const ads = await prisma_1.default.ad.findMany({
            where: { business_id: { in: cardIds } },
            include: { business: { select: { id: true, company_name: true } } },
            orderBy: { created_at: 'desc' },
        });
        res.json(ads);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch ads' });
    }
}
//# sourceMappingURL=adController.js.map