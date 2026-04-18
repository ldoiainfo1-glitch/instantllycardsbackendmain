"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const prisma_1 = __importDefault(require("../utils/prisma"));
const socket_1 = require("../utils/socket");
const adminController_1 = require("../controllers/adminController");
const router = (0, express_1.Router)();
const h = (fn) => fn;
router.use(auth_1.authenticate, (0, auth_1.requireRole)('admin'));
router.get('/dashboard', h(adminController_1.getDashboardCounts));
router.get('/users', h(adminController_1.listUsers));
// Promotions
router.get('/promotions/pending', h(adminController_1.getPendingPromotions));
router.post('/promotions/:id/approve', h(adminController_1.approvePromotion));
router.post('/promotions/:id/reject', h(adminController_1.rejectPromotion));
// Listings
router.get('/businesses', h(adminController_1.listBusinesses));
router.post('/businesses/:id/approve', h(adminController_1.approveBusinessCard));
router.post('/businesses/:id/reject', h(adminController_1.rejectBusinessCard));
router.get('/events', h(adminController_1.listEvents));
router.get('/vouchers', h(adminController_1.listVouchers));
router.get('/reviews', h(adminController_1.listReviews));
// Ad campaigns
router.get('/ads', h(adminController_1.listAdCampaigns));
router.get('/ads/:id', async (req, res) => {
    const { getAdCampaignDetails } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return getAdCampaignDetails(req, res);
});
router.post('/ads/:id/approve', h(adminController_1.approveAdCampaign));
router.post('/ads/:id/reject', h(adminController_1.rejectAdCampaign));
router.post('/ads/:id/pause', async (req, res) => {
    const { pauseAdCampaign } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return pauseAdCampaign(req, res);
});
router.post('/ads/:id/resume', async (req, res) => {
    const { resumeAdCampaign } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return resumeAdCampaign(req, res);
});
router.post('/ads/:id/delete', async (req, res) => {
    const { deleteAdCampaign } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return deleteAdCampaign(req, res);
});
// ── Credit management ─────────────────────────────────────────────────────────
function randomAlphaNumeric(len) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < len; i++)
        out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}
// POST /api/admin/transfer-credits
router.post('/transfer-credits', async (req, res) => {
    try {
        const { userId, amount, note } = req.body;
        const creditAmount = Number(amount);
        if (!userId || !creditAmount) {
            res.status(400).json({ error: 'userId and amount are required' });
            return;
        }
        const user = await prisma_1.default.user.findUnique({ where: { id: Number(userId) } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const newBalance = Number(user.credits ?? 0) + creditAmount;
        await prisma_1.default.user.update({ where: { id: Number(userId) }, data: { credits: BigInt(newBalance) } });
        await prisma_1.default.transaction.create({
            data: {
                type: 'admin_adjustment',
                transaction_id: 'TXN' + randomAlphaNumeric(9),
                to_user_id: Number(userId),
                amount: creditAmount,
                description: note || 'Admin credit adjustment',
                status: 'completed',
            },
        });
        const io = (0, socket_1.getIo)();
        io?.emit(`credits_updated_${userId}`, { credits: newBalance });
        res.json({ success: true, newBalance });
    }
    catch (err) {
        console.error('[admin/transfer-credits]', err);
        res.status(500).json({ error: 'Failed to transfer credits' });
    }
});
// PUT /api/admin/users/:id/update-credits
router.put('/users/:id/update-credits', async (req, res) => {
    try {
        const { credits } = req.body;
        const userId = Number(req.params.id);
        const newCredits = Number(credits);
        const user = await prisma_1.default.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const diff = newCredits - Number(user.credits ?? 0);
        const updatedUser = await prisma_1.default.user.update({
            where: { id: userId },
            data: { credits: BigInt(newCredits) },
        });
        if (diff !== 0) {
            await prisma_1.default.transaction.create({
                data: {
                    type: 'admin_adjustment',
                    transaction_id: 'TXN' + randomAlphaNumeric(9),
                    ...(diff > 0 ? { to_user_id: userId } : { from_user_id: userId }),
                    amount: Math.abs(diff),
                    description: 'Admin credit update',
                    status: 'completed',
                },
            });
        }
        res.json({ success: true, user: updatedUser });
    }
    catch (err) {
        console.error('[admin/update-credits]', err);
        res.status(500).json({ error: 'Failed to update credits' });
    }
});
// GET /api/admin/all-transactions
router.get('/all-transactions', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
        const typeFilter = req.query.type;
        const userIdFilter = req.query.userId ? Number(req.query.userId) : undefined;
        const where = {};
        if (typeFilter)
            where.type = typeFilter;
        if (userIdFilter) {
            where.OR = [{ from_user_id: userIdFilter }, { to_user_id: userIdFilter }];
        }
        const [rows, total] = await Promise.all([
            prisma_1.default.transaction.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    from_user: { select: { id: true, name: true, phone: true } },
                    to_user: { select: { id: true, name: true, phone: true } },
                },
            }),
            prisma_1.default.transaction.count({ where }),
        ]);
        res.json({ transactions: rows, totalPages: Math.ceil(total / limit), currentPage: page, total });
    }
    catch (err) {
        console.error('[admin/all-transactions]', err);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map