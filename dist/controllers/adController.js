"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAds = listAds;
exports.trackImpression = trackImpression;
exports.trackClick = trackClick;
exports.getMyAds = getMyAds;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
async function listAds(_req, res) {
    const ads = await prisma_1.default.ad.findMany({
        where: { status: 'active' },
        orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
        include: { business: { select: { id: true, company_name: true, logo_url: true } } },
        take: 50,
    });
    res.json(ads);
}
async function trackImpression(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    await prisma_1.default.$transaction([
        prisma_1.default.adImpression.create({ data: { ad_id: id, user_id: req.user?.userId } }),
        prisma_1.default.ad.update({ where: { id }, data: { impressions: { increment: 1 } } }),
    ]);
    res.json({ ok: true });
}
async function trackClick(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    await prisma_1.default.$transaction([
        prisma_1.default.adClick.create({ data: { ad_id: id, user_id: req.user?.userId } }),
        prisma_1.default.ad.update({ where: { id }, data: { clicks: { increment: 1 } } }),
    ]);
    res.json({ ok: true });
}
async function getMyAds(req, res) {
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
//# sourceMappingURL=adController.js.map