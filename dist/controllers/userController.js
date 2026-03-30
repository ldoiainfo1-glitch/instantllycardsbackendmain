"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfile = getProfile;
exports.updateProfile = updateProfile;
exports.getUserById = getUserById;
exports.getUserLocation = getUserLocation;
exports.upsertUserLocation = upsertUserLocation;
exports.deleteMe = deleteMe;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const serialize_1 = require("../utils/serialize");
async function getProfile(req, res) {
    const user = await prisma_1.default.user.findUnique({
        where: { id: req.user.userId },
        include: { profile: true, user_roles: true },
        omit: { password_hash: true },
    });
    if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json((0, serialize_1.jsonSafe)(user));
}
async function updateProfile(req, res) {
    const { name, about, gender, profile_picture, phone } = req.body;
    const userId = req.user.userId;
    const updateData = { name, about, gender, profile_picture };
    if (phone) {
        const normalizedPhone = String(phone).trim();
        const existing = await prisma_1.default.user.findFirst({
            where: { phone: normalizedPhone, id: { not: userId } },
        });
        if (existing) {
            res.status(409).json({ error: 'Phone already in use' });
            return;
        }
        updateData.phone = normalizedPhone;
    }
    const user = await prisma_1.default.user.update({
        where: { id: userId },
        data: updateData,
    });
    await prisma_1.default.profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            full_name: name,
            avatar_url: profile_picture,
            bio: about,
            phone: phone ? String(phone).trim() : undefined,
        },
        update: {
            full_name: name,
            avatar_url: profile_picture,
            bio: about,
            phone: phone ? String(phone).trim() : undefined,
        },
    });
    res.json({ message: 'Profile updated' });
}
async function getUserById(req, res) {
    const userId = (0, params_1.paramInt)(req.params.id);
    const user = await prisma_1.default.user.findUnique({
        where: { id: userId },
        include: { profile: true, user_roles: true, business_cards: { take: 5 } },
        omit: { password_hash: true },
    });
    if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json((0, serialize_1.jsonSafe)(user));
}
async function getUserLocation(req, res) {
    const location = await prisma_1.default.userLocation.findUnique({
        where: { user_id: req.user.userId },
    });
    res.json((0, serialize_1.jsonSafe)(location ?? {}));
}
async function upsertUserLocation(req, res) {
    const userId = req.user.userId;
    const data = {};
    if (req.body?.current_location !== undefined)
        data.current_location = req.body.current_location;
    if (req.body?.address !== undefined)
        data.address = req.body.address;
    if (req.body?.accuracy !== undefined)
        data.accuracy = req.body.accuracy;
    if (req.body?.radius !== undefined)
        data.radius = req.body.radius;
    if (req.body?.is_location_enabled !== undefined)
        data.is_location_enabled = Boolean(req.body.is_location_enabled);
    if (req.body?.share_location_with !== undefined)
        data.share_location_with = String(req.body.share_location_with);
    data.last_updated = new Date();
    const location = await prisma_1.default.userLocation.upsert({
        where: { user_id: userId },
        create: { user_id: userId, ...data },
        update: data,
    });
    res.json((0, serialize_1.jsonSafe)(location));
}
async function deleteMe(req, res) {
    const userId = req.user.userId;
    try {
        const anonymized = `deleted_${userId}_${Date.now()}`;
        await prisma_1.default.$transaction(async (tx) => {
            // Revoke all sessions
            await tx.refreshToken.deleteMany({ where: { user_id: userId } });
            // Remove profile record
            await tx.profile.deleteMany({ where: { user_id: userId } });
            // Remove roles
            await tx.userRole.deleteMany({ where: { user_id: userId } });
            // Anonymize personal data (soft delete — preserves referential integrity)
            await tx.user.update({
                where: { id: userId },
                data: {
                    email: `${anonymized}@deleted.invalid`,
                    phone: anonymized,
                    name: null,
                    about: null,
                    profile_picture: null,
                    password_hash: null,
                },
            });
        });
        console.log(`[DELETE-ACCOUNT] Anonymized userId: ${userId}`);
        res.json({ message: 'Account deleted' });
    }
    catch (err) {
        console.error('[DELETE-ACCOUNT] Failed', err);
        res.status(500).json({ error: 'Failed to delete account' });
    }
}
//# sourceMappingURL=userController.js.map