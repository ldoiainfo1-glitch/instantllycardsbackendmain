"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listVouchers = listVouchers;
exports.getVoucher = getVoucher;
exports.createVoucher = createVoucher;
exports.claimVoucher = claimVoucher;
exports.transferVoucher = transferVoucher;
exports.getMyVouchers = getMyVouchers;
exports.getMyCreatedVouchers = getMyCreatedVouchers;
exports.getMyTransfers = getMyTransfers;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const phone_1 = require("../utils/phone");
async function listVouchers(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const vouchers = await prisma_1.default.voucher.findMany({
        where: { status: 'active' },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { business: { select: { id: true, company_name: true, logo_url: true } } },
    });
    res.json({ data: vouchers, page, limit });
}
async function getVoucher(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const voucher = await prisma_1.default.voucher.findUnique({
        where: { id },
        include: { business: true },
    });
    if (!voucher) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(voucher);
}
async function createVoucher(req, res) {
    const { business_id, title, description, discount_type, discount_value, code, max_claims, expires_at, } = req.body;
    const businessId = parseInt(business_id, 10);
    if (!businessId || !title) {
        res.status(400).json({ error: 'business_id and title are required' });
        return;
    }
    const card = await prisma_1.default.businessCard.findUnique({ where: { id: businessId } });
    if (!card) {
        res.status(404).json({ error: 'Business card not found' });
        return;
    }
    if (card.user_id !== req.user.userId && !req.user.roles.includes('admin')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const discountValue = parseFloat(discount_value);
    if (Number.isNaN(discountValue)) {
        res.status(400).json({ error: 'discount_value must be a number' });
        return;
    }
    const voucher = await prisma_1.default.voucher.create({
        data: {
            business_id: card.id,
            business_name: card.company_name || card.full_name,
            title,
            description: description || null,
            discount_type: discount_type || 'flat',
            discount_value: discountValue,
            code: code || null,
            max_claims: max_claims ? parseInt(max_claims, 10) : null,
            expires_at: expires_at ? new Date(expires_at) : null,
            status: 'active',
            owner_user_id: req.user.userId,
        },
    });
    res.status(201).json(voucher);
}
async function claimVoucher(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const voucher = await prisma_1.default.voucher.findUnique({ where: { id } });
    if (!voucher) {
        res.status(404).json({ error: 'Voucher not found' });
        return;
    }
    if (voucher.status !== 'active') {
        res.status(400).json({ error: 'Voucher not active' });
        return;
    }
    if (voucher.max_claims && voucher.claimed_count >= voucher.max_claims) {
        res.status(400).json({ error: 'Voucher fully claimed' });
        return;
    }
    const alreadyClaimed = await prisma_1.default.voucherClaim.findFirst({
        where: { voucher_id: id, user_id: req.user.userId },
    });
    if (alreadyClaimed) {
        res.status(409).json({ error: 'Already claimed' });
        return;
    }
    const [claim] = await prisma_1.default.$transaction([
        prisma_1.default.voucherClaim.create({ data: { voucher_id: id, user_id: req.user.userId } }),
        prisma_1.default.voucher.update({ where: { id }, data: { claimed_count: { increment: 1 } } }),
    ]);
    res.status(201).json(claim);
}
async function transferVoucher(req, res) {
    const { voucher_id, recipient_phone } = req.body;
    const vId = parseInt(voucher_id, 10);
    const voucher = await prisma_1.default.voucher.findUnique({ where: { id: vId } });
    if (!voucher) {
        res.status(404).json({ error: 'Voucher not found' });
        return;
    }
    const claim = await prisma_1.default.voucherClaim.findFirst({
        where: { voucher_id: vId, user_id: req.user.userId },
    });
    if (!claim) {
        res.status(403).json({ error: 'You do not own this voucher claim' });
        return;
    }
    const variants = (0, phone_1.phoneVariants)(recipient_phone || '');
    const recipient = await prisma_1.default.user.findFirst({
        where: { OR: variants.map((p) => ({ phone: p })) },
    });
    if (!recipient) {
        res.status(404).json({ error: 'Recipient not found' });
        return;
    }
    const sender = await prisma_1.default.user.findUnique({ where: { id: req.user.userId } });
    const normalizedRecipientPhone = (0, phone_1.normalizePhone)(recipient_phone);
    const transfer = await prisma_1.default.voucherTransfer.create({
        data: {
            voucher_id: vId,
            sender_id: req.user.userId,
            recipient_id: recipient.id,
            sender_phone: sender.phone,
            recipient_phone: normalizedRecipientPhone,
        },
    });
    res.status(201).json(transfer);
}
async function getMyVouchers(req, res) {
    const claims = await prisma_1.default.voucherClaim.findMany({
        where: { user_id: req.user.userId },
        include: {
            voucher: { include: { business: { select: { id: true, company_name: true, logo_url: true } } } },
        },
        orderBy: { claimed_at: 'desc' },
    });
    res.json(claims);
}
async function getMyCreatedVouchers(req, res) {
    const cards = await prisma_1.default.businessCard.findMany({
        where: { user_id: req.user.userId },
        select: { id: true },
    });
    const cardIds = cards.map((c) => c.id);
    const vouchers = await prisma_1.default.voucher.findMany({
        where: {
            OR: [
                { owner_user_id: req.user.userId },
                { business_id: { in: cardIds } },
            ],
        },
        orderBy: { created_at: 'desc' },
    });
    res.json(vouchers);
}
async function getMyTransfers(req, res) {
    const userId = req.user.userId;
    const transfers = await prisma_1.default.voucherTransfer.findMany({
        where: { OR: [{ sender_id: userId }, { recipient_id: userId }] },
        orderBy: { transferred_at: 'desc' },
    });
    res.json(transfers);
}
//# sourceMappingURL=voucherController.js.map