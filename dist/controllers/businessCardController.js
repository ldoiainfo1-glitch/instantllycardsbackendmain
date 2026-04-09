"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCards = listCards;
exports.getCard = getCard;
exports.createCard = createCard;
exports.updateCard = updateCard;
exports.deleteCard = deleteCard;
exports.getMyCards = getMyCards;
exports.shareCard = shareCard;
exports.getSharedCards = getSharedCards;
exports.bulkSendCard = bulkSendCard;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
/** Whitelisted fields for card create/update — prevents arbitrary field injection. */
const CARD_FIELDS = [
    'full_name', 'birthdate', 'anniversary', 'gender', 'phone', 'whatsapp', 'telegram',
    'email', 'location', 'maps_link', 'company_name', 'job_title', 'company_phone',
    'company_email', 'website', 'company_address', 'company_maps_link', 'logo_url',
    'description', 'business_hours', 'category', 'established_year', 'instagram',
    'facebook', 'linkedin', 'youtube', 'twitter', 'keywords', 'offer', 'services',
    'personal_country_code', 'company_country_code', 'company_photo', 'about_business',
    'is_default', 'company_website', 'message', 'services_offered',
    'is_live', 'latitude', 'longitude', 'service_mode', 'home_service',
];
function pickCardFields(body) {
    const result = {};
    for (const key of CARD_FIELDS) {
        if (key in body)
            result[key] = body[key];
    }
    // Coerce date strings to Date objects for Prisma DateTime fields
    for (const dateField of ['birthdate', 'anniversary']) {
        if (result[dateField] && typeof result[dateField] === 'string') {
            const d = new Date(result[dateField]);
            result[dateField] = isNaN(d.getTime()) ? null : d;
        }
    }
    return result;
}
async function listCards(req, res) {
    try {
        const page = (0, params_1.queryInt)(req.query.page, 1);
        const limit = (0, params_1.queryInt)(req.query.limit, 20);
        const search = (0, params_1.queryStr)(req.query.search);
        const category = (0, params_1.queryStr)(req.query.category);
        const approvalStatus = (0, params_1.queryStr)(req.query.approval_status);
        const isLive = req.query.is_live;
        const where = {};
        // Only show approved + live cards by default (public listing)
        if (approvalStatus) {
            where.approval_status = approvalStatus;
        }
        else {
            where.approval_status = 'approved';
        }
        if (isLive === 'true') {
            where.is_live = true;
        }
        else if (isLive === 'false') {
            where.is_live = false;
        }
        else {
            where.is_live = true; // Default: only show live cards
        }
        if (category) {
            where.category = { contains: category, mode: 'insensitive' };
        }
        if (search) {
            where.OR = [
                { full_name: { contains: search, mode: 'insensitive' } },
                { company_name: { contains: search, mode: 'insensitive' } },
                { category: { contains: search, mode: 'insensitive' } },
            ];
        }
        const [cards, total] = await Promise.all([
            prisma_1.default.businessCard.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    user_id: true,
                    full_name: true,
                    phone: true,
                    email: true,
                    company_name: true,
                    job_title: true,
                    logo_url: true,
                    description: true,
                    category: true,
                    services: true,
                    offer: true,
                    website: true,
                    business_hours: true,
                    location: true,
                    maps_link: true,
                    whatsapp: true,
                    telegram: true,
                    instagram: true,
                    facebook: true,
                    linkedin: true,
                    youtube: true,
                    twitter: true,
                    company_phone: true,
                    company_email: true,
                    company_address: true,
                    company_maps_link: true,
                    keywords: true,
                    established_year: true,
                    gender: true,
                    birthdate: true,
                    anniversary: true,
                    personal_country_code: true,
                    company_country_code: true,
                    company_photo: true,
                    about_business: true,
                    is_default: true,
                    approval_status: true,
                    is_live: true,
                    latitude: true,
                    longitude: true,
                    service_mode: true,
                    company_website: true,
                    services_offered: true,
                    message: true,
                    created_at: true,
                    updated_at: true,
                },
            }),
            prisma_1.default.businessCard.count({ where }),
        ]);
        res.json({ data: cards, page, limit, total });
    }
    catch (err) {
        console.error('[LIST-CARDS] Failed', err);
        res.status(500).json({ error: 'Failed to list cards' });
    }
}
async function getCard(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const card = await prisma_1.default.businessCard.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, name: true, profile_picture: true } },
                reviews: { take: 5, orderBy: { created_at: 'desc' } },
                vouchers: { where: { status: 'active' }, take: 5 },
            },
        });
        if (!card) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(card);
    }
    catch (err) {
        console.error('[GET-CARD] Failed', err);
        res.status(500).json({ error: 'Failed to get card' });
    }
}
async function createCard(req, res) {
    try {
        const data = pickCardFields(req.body);
        const card = await prisma_1.default.businessCard.create({
            data: { ...data, user_id: req.user.userId, approval_status: 'pending' },
        });
        // Business role is NOT auto-assigned here.
        // It will be granted when admin approves the card.
        res.status(201).json(card);
    }
    catch (err) {
        console.error('[CREATE-CARD] Failed', err);
        res.status(500).json({ error: 'Failed to create card' });
    }
}
async function updateCard(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const card = await prisma_1.default.businessCard.findUnique({ where: { id } });
        if (!card) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        if (card.user_id !== req.user.userId && !req.user.roles.includes('admin')) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        const data = pickCardFields(req.body);
        const updated = await prisma_1.default.businessCard.update({ where: { id }, data });
        res.json(updated);
    }
    catch (err) {
        console.error('[UPDATE-CARD] Failed', err);
        res.status(500).json({ error: 'Failed to update card' });
    }
}
async function deleteCard(req, res) {
    try {
        const id = (0, params_1.paramInt)(req.params.id);
        const card = await prisma_1.default.businessCard.findUnique({ where: { id } });
        if (!card) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        if (card.user_id !== req.user.userId && !req.user.roles.includes('admin')) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        await prisma_1.default.businessCard.delete({ where: { id } });
        res.json({ message: 'Deleted' });
    }
    catch (err) {
        console.error('[DELETE-CARD] Failed', err);
        res.status(500).json({ error: 'Failed to delete card' });
    }
}
async function getMyCards(req, res) {
    console.log(`[getMyCards] userId: ${req.user.userId}`);
    const cards = await prisma_1.default.businessCard.findMany({
        where: { user_id: req.user.userId },
        orderBy: { created_at: 'desc' },
    });
    console.log(`[getMyCards] Found ${cards.length} cards for user ${req.user.userId}`);
    console.log(`[getMyCards] Card IDs: ${cards.map(c => c.id).join(', ')}`);
    res.json(cards);
}
async function shareCard(req, res) {
    try {
        const { card_id, recipient_user_id, message } = req.body;
        const sender = await prisma_1.default.user.findUnique({ where: { id: req.user.userId } });
        const card = await prisma_1.default.businessCard.findUnique({ where: { id: parseInt(card_id) } });
        if (!card || !sender) {
            res.status(404).json({ error: 'Card or sender not found' });
            return;
        }
        const recipient = recipient_user_id
            ? await prisma_1.default.user.findUnique({ where: { id: parseInt(recipient_user_id) } })
            : null;
        const share = await prisma_1.default.sharedCard.create({
            data: {
                card_id: card.id,
                sender_id: String(sender.id),
                recipient_id: recipient ? String(recipient.id) : '0',
                message: message || null,
                card_title: card.company_name || card.full_name,
                sender_name: sender.name || sender.phone,
                recipient_name: recipient?.name || recipient?.phone || 'Unknown',
                card_photo: card.company_photo || card.logo_url,
                sender_profile_picture: sender.profile_picture,
            },
        });
        res.status(201).json(share);
    }
    catch (err) {
        console.error('[SHARE-CARD] Failed', err);
        res.status(500).json({ error: 'Failed to share card' });
    }
}
async function getSharedCards(req, res) {
    try {
        const userId = String(req.user.userId);
        const shares = await prisma_1.default.sharedCard.findMany({
            where: { OR: [{ recipient_id: userId }, { sender_id: userId }] },
            include: { card: true },
            orderBy: { created_at: 'desc' },
        });
        res.json(shares);
    }
    catch (err) {
        console.error('[SHARED-CARDS] Failed', err);
        res.status(500).json({ error: 'Failed to get shared cards' });
    }
}
/**
 * POST /api/cards/bulk-send
 * Sends a business card to every user who has an approved, live card
 * in the specified category (or subcategory). Skips the sender themselves
 * and skips any duplicate (same card → same recipient) within the last 30 days.
 */
async function bulkSendCard(req, res) {
    try {
        const senderId = req.user.userId;
        const { card_id, audience, audience_type, level } = req.body;
        if (!card_id || !audience || !level) {
            res.status(400).json({ error: 'card_id, audience and level are required' });
            return;
        }
        const cardId = parseInt(String(card_id), 10);
        // Verify the sender owns this card
        const senderCard = await prisma_1.default.businessCard.findUnique({ where: { id: cardId } });
        if (!senderCard || senderCard.user_id !== senderId) {
            res.status(403).json({ error: 'Card not found or not owned by you' });
            return;
        }
        const sender = await prisma_1.default.user.findUnique({ where: { id: senderId } });
        if (!sender) {
            res.status(404).json({ error: 'Sender not found' });
            return;
        }
        // Find all users who have approved+live cards in that category
        const recipientCards = await prisma_1.default.businessCard.findMany({
            where: {
                approval_status: 'approved',
                is_live: true,
                category: { contains: audience, mode: 'insensitive' },
                user_id: { not: senderId }, // exclude sender
            },
            select: {
                id: true,
                user_id: true,
                user: { select: { id: true, name: true, phone: true } },
            },
        });
        if (recipientCards.length === 0) {
            res.json({ sent: 0, message: 'No recipients found in this category yet' });
            return;
        }
        // Deduplicate by user_id (one user may have multiple cards in same category)
        const seenUsers = new Set();
        const uniqueRecipients = recipientCards.filter((rc) => {
            if (seenUsers.has(rc.user_id))
                return false;
            seenUsers.add(rc.user_id);
            return true;
        });
        // Guard against re-sending same card to same recipient within 30 days
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const existingSends = await prisma_1.default.sharedCard.findMany({
            where: {
                card_id: cardId,
                sender_id: String(senderId),
                sent_at: { gte: cutoff },
            },
            select: { recipient_id: true },
        });
        const alreadySentTo = new Set(existingSends.map((s) => s.recipient_id));
        const newRecipients = uniqueRecipients.filter((r) => !alreadySentTo.has(String(r.user_id)));
        if (newRecipients.length === 0) {
            res.json({ sent: 0, message: 'Card already sent to all recipients in this category recently' });
            return;
        }
        // Batch create SharedCard rows
        await prisma_1.default.sharedCard.createMany({
            data: newRecipients.map((r) => ({
                card_id: cardId,
                sender_id: String(senderId),
                recipient_id: String(r.user_id),
                card_title: senderCard.company_name || senderCard.full_name,
                sender_name: sender.name || sender.phone,
                recipient_name: r.user?.name || r.user?.phone || 'User',
                card_photo: senderCard.company_photo || senderCard.logo_url || null,
                sender_profile_picture: sender.profile_picture ?? null,
                message: `Bulk send · ${audience} · ${level}`,
            })),
            skipDuplicates: true,
        });
        res.status(201).json({
            sent: newRecipients.length,
            audience,
            level,
            message: `Card sent to ${newRecipients.length} recipient(s) in "${audience}"`,
        });
    }
    catch (err) {
        console.error('[BULK-SEND] Failed', err);
        res.status(500).json({ error: 'Failed to bulk send card' });
    }
}
//# sourceMappingURL=businessCardController.js.map