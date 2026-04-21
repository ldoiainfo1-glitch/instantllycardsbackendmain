"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signup = signup;
exports.login = login;
exports.refresh = refresh;
exports.logout = logout;
exports.me = me;
exports.changePassword = changePassword;
exports.sendPasswordResetOTP = sendPasswordResetOTP;
exports.verifyPasswordResetOTP = verifyPasswordResetOTP;
exports.resetPassword = resetPassword;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const jwt_1 = require("../utils/jwt");
const serialize_1 = require("../utils/serialize");
const phone_1 = require("../utils/phone");
const otp_1 = require("../utils/otp");
const socketService_1 = require("../services/socketService");
const push_1 = require("../utils/push");
const IS_PROD = process.env.NODE_ENV === 'production';
const log = (...args) => { if (!IS_PROD)
    console.log(...args); };
const warn = (...args) => { if (!IS_PROD)
    console.warn(...args); };
async function getUserRoles(userId) {
    const roles = await prisma_1.default.userRole.findMany({ where: { user_id: userId } });
    return roles.map((r) => r.role);
}
async function signup(req, res) {
    const { phone, email, password, name, role = 'customer', referralCode } = req.body;
    const normalizedPhone = phone ? (0, phone_1.normalizePhone)(phone) : phone;
    log(`[SIGNUP] Attempt — phone: ${phone} → normalized: ${normalizedPhone}, email: ${email ?? 'N/A'}, name: ${name ?? 'N/A'}, role: ${role}`);
    const validRoles = ['customer', 'business'];
    if (!validRoles.includes(role)) {
        warn(`[SIGNUP] Invalid role: ${role}`);
        res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
        return;
    }
    try {
        const variants = phone ? (0, phone_1.phoneVariants)(phone) : [];
        const existing = await prisma_1.default.user.findFirst({
            where: {
                OR: [
                    ...(variants.map((p) => ({ phone: p }))),
                    ...(email ? [{ email }] : []),
                ],
            },
        });
        if (existing) {
            warn(`[SIGNUP] Conflict — phone/email already registered: ${normalizedPhone ?? email}`);
            res.status(409).json({ error: 'User with this phone/email already exists' });
            return;
        }
        const password_hash = await bcryptjs_1.default.hash(password, 10);
        const roles = [role];
        // Generate a unique referral code for the new user
        const newReferralCode = await generateUniqueReferralCode();
        // Look up referrer if a referral code was provided
        let referrerId = null;
        if (referralCode && typeof referralCode === 'string' && referralCode.trim().length > 0) {
            const referrer = await prisma_1.default.user.findFirst({
                where: { referral_code: referralCode.trim().toUpperCase() },
                select: { id: true },
            });
            if (!referrer) {
                warn(`[SIGNUP] Invalid referral code: ${referralCode}`);
                res.status(400).json({ error: 'Invalid referral code' });
                return;
            }
            // Prevent self-referral
            const existingUser = await prisma_1.default.user.findFirst({
                where: { referral_code: referralCode.trim().toUpperCase() },
                select: { id: true, phone: true },
            });
            if (existingUser && normalizedPhone && (0, phone_1.phoneVariants)(phone).includes(existingUser.phone ?? '')) {
                res.status(400).json({ error: 'You cannot use your own referral code' });
                return;
            }
            referrerId = referrer.id;
            log(`[SIGNUP] Referrer found — referralCode: ${referralCode}, referrerId: ${referrerId}`);
        }
        // Atomic transaction: user + role + refresh token all succeed or all roll back
        const result = await prisma_1.default.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    phone: normalizedPhone,
                    email: email || null,
                    password_hash,
                    name: name || null,
                    referral_code: newReferralCode,
                    referred_by_id: referrerId,
                },
            });
            log(`[SIGNUP] User created — id: ${user.id}, phone: ${user.phone}, referralCode: ${newReferralCode}`);
            await tx.userRole.create({ data: { user_id: user.id, role } });
            log(`[SIGNUP] Role assigned — userId: ${user.id}, role: ${role}`);
            const accessToken = (0, jwt_1.signAccessToken)({ userId: user.id, roles });
            const refreshToken = (0, jwt_1.signRefreshToken)({ userId: user.id, roles });
            await tx.refreshToken.create({
                data: {
                    user_id: user.id,
                    token_hash: (0, jwt_1.hashToken)(refreshToken),
                    expires_at: (0, jwt_1.refreshTokenExpiry)(),
                },
            });
            log(`[SIGNUP] Tokens issued — userId: ${user.id}`);
            // Create referral record if referred
            if (referrerId) {
                await tx.referral.create({
                    data: { referrer_id: referrerId, referred_id: user.id, status: 'completed', reward_given: false },
                });
            }
            return { user, accessToken, refreshToken };
        });
        // Award referral bonus OUTSIDE the main transaction (non-blocking)
        if (referrerId) {
            processReferralReward(referrerId, result.user.id).catch((err) => {
                console.error('[SIGNUP] Referral reward processing failed (non-blocking):', err);
            });
        }
        res.status(201).json({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            user: {
                id: result.user.id,
                phone: result.user.phone,
                email: result.user.email,
                name: result.user.name,
                roles,
                referralCode: newReferralCode,
            },
        });
        // Send welcome notification to new user (socket — FCM token not available yet)
        try {
            const io = (0, socketService_1.getIO)();
            if (io) {
                io.to(`user:${result.user.id}`).emit('welcome', {
                    type: 'welcome',
                    title: `Welcome to Instantlly Cards! 🎉`,
                    body: `Hi ${result.user.name ?? 'there'}! Your account is ready. Start exploring business cards, events & more.`,
                });
            }
        }
        catch { /* non-blocking */ }
    }
    catch (err) {
        if (err?.code === 'P2002') {
            warn(`[SIGNUP] Conflict (unique constraint) — ${normalizedPhone ?? email}`);
            res.status(409).json({ error: 'User with this phone/email already exists' });
            return;
        }
        console.error('[SIGNUP] Failed', err);
        res.status(500).json({ error: 'Signup failed' });
    }
}
// ── Referral helpers ───────────────────────────────────────────────────────────
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
async function generateUniqueReferralCode() {
    for (let i = 0; i < 20; i++) {
        const code = generateReferralCode();
        const exists = await prisma_1.default.user.findFirst({ where: { referral_code: code } });
        if (!exists)
            return code;
    }
    // Fallback: timestamp-based
    return generateReferralCode() + Date.now().toString(36).slice(-2).toUpperCase();
}
async function processReferralReward(referrerId, newUserId) {
    try {
        // Get config
        const config = await prisma_1.default.creditConfig.findFirst();
        const rewardAmount = config?.referral_reward ?? 300;
        if (rewardAmount <= 0)
            return;
        const [referrer, newUser] = await Promise.all([
            prisma_1.default.user.findUnique({ where: { id: referrerId } }),
            prisma_1.default.user.findUnique({ where: { id: newUserId } }),
        ]);
        if (!referrer || !newUser)
            return;
        const referrerNewBalance = Number(referrer.credits ?? 0) + rewardAmount;
        const newUserNewBalance = Number(newUser.credits ?? 0) + rewardAmount;
        await prisma_1.default.$transaction(async (tx) => {
            // Award credits to referrer (clear expiry so old expired dates don't zero out new credits)
            await tx.user.update({
                where: { id: referrerId },
                data: { credits: BigInt(referrerNewBalance), credits_expiry_date: null },
            });
            await tx.transaction.create({
                data: {
                    type: 'referral_bonus',
                    to_user_id: referrerId,
                    from_user_id: newUserId,
                    amount: rewardAmount,
                    description: `Referral bonus: ${newUser.name ?? newUser.phone ?? 'A friend'} joined using your code`,
                    status: 'completed',
                    balance_after: referrerNewBalance,
                },
            });
            // Award credits to new user (referred user)
            await tx.user.update({
                where: { id: newUserId },
                data: { credits: BigInt(newUserNewBalance) },
            });
            await tx.transaction.create({
                data: {
                    type: 'signup_bonus',
                    to_user_id: newUserId,
                    from_user_id: referrerId,
                    amount: rewardAmount,
                    description: `Signup bonus: joined via referral code`,
                    status: 'completed',
                    balance_after: newUserNewBalance,
                },
            });
            // Mark referral as reward given
            await tx.referral.updateMany({
                where: { referrer_id: referrerId, referred_id: newUserId },
                data: { reward_given: true },
            });
        });
        log(`[REFERRAL] Awarded ${rewardAmount} credits each to referrer ${referrerId} and new user ${newUserId}`);
    }
    catch (err) {
        console.error('[REFERRAL] Failed to process reward:', err);
    }
}
async function login(req, res) {
    const { phone, email, password, loginType } = req.body;
    log(`[LOGIN] Attempt — identifier: ${phone ?? email}, loginType: ${loginType ?? 'any'}`);
    try {
        const variants = phone ? (0, phone_1.phoneVariants)(phone) : [];
        log(`[LOGIN] Phone variants to try: [${variants.join(', ')}]`);
        const user = await prisma_1.default.user.findFirst({
            where: {
                OR: [
                    ...(variants.map((p) => ({ phone: p }))),
                    ...(email ? [{ email }] : []),
                ],
            },
        });
        if (!user || !user.password_hash) {
            warn(`[LOGIN] Failed — user not found for: ${phone ?? email} (tried variants: ${variants.join(', ')})`);
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            warn(`[LOGIN] Failed — wrong password for userId: ${user.id}`);
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const roles = await getUserRoles(user.id);
        // Validate loginType — if user requests business tab but doesn't have the role, reject
        if (loginType === 'business' && !roles.includes('business')) {
            warn(`[LOGIN] Rejected — userId: ${user.id} tried loginType=business but roles=[${roles.join(', ')}]`);
            res.status(403).json({ error: 'You do not have a business account. Please promote your business first.' });
            return;
        }
        log(`[LOGIN] Success — userId: ${user.id}, phone: ${user.phone}, rolesFromDB: [${roles.join(', ')}], roleCount: ${roles.length}`);
        const accessToken = (0, jwt_1.signAccessToken)({ userId: user.id, roles });
        const refreshToken = (0, jwt_1.signRefreshToken)({ userId: user.id, roles });
        await prisma_1.default.refreshToken.create({
            data: {
                user_id: user.id,
                token_hash: (0, jwt_1.hashToken)(refreshToken),
                expires_at: (0, jwt_1.refreshTokenExpiry)(),
            },
        });
        log(`[LOGIN] Tokens issued — userId: ${user.id}, rolesInToken: [${roles.join(', ')}]`);
        res.json({
            accessToken,
            refreshToken,
            user: { id: user.id, phone: user.phone, email: user.email, name: user.name, roles },
        });
        // Send welcome back notification (socket + FCM if token exists)
        try {
            const io = (0, socketService_1.getIO)();
            const welcomePayload = {
                type: 'welcome_back',
                title: `Welcome back! 👋`,
                body: `Good to see you again, ${user.name ?? 'there'}!`,
            };
            if (io)
                io.to(`user:${user.id}`).emit('welcome_back', welcomePayload);
            if (user.push_token) {
                (0, push_1.sendExpoPushNotification)(user.push_token, `Welcome back! 👋`, `Good to see you again, ${user.name ?? 'there'}!`, {});
            }
        }
        catch { /* non-blocking */ }
    }
    catch (err) {
        console.error('[LOGIN] Failed', err);
        res.status(500).json({ error: 'Login failed' });
    }
}
async function refresh(req, res) {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        res.status(400).json({ error: 'refreshToken required' });
        return;
    }
    let payload;
    try {
        payload = (0, jwt_1.verifyRefreshToken)(refreshToken);
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
        return;
    }
    const tokenHash = (0, jwt_1.hashToken)(refreshToken);
    const stored = await prisma_1.default.refreshToken.findFirst({
        where: { user_id: payload.userId, token_hash: tokenHash },
    });
    if (!stored || stored.expires_at < new Date()) {
        res.status(401).json({ error: 'Refresh token revoked or expired' });
        return;
    }
    // Rotate: delete old, issue new (deleteMany avoids race-condition P2025)
    await prisma_1.default.refreshToken.deleteMany({ where: { id: stored.id } });
    const roles = await getUserRoles(payload.userId);
    const newAccess = (0, jwt_1.signAccessToken)({ userId: payload.userId, roles });
    const newRefresh = (0, jwt_1.signRefreshToken)({ userId: payload.userId, roles });
    await prisma_1.default.refreshToken.create({
        data: {
            user_id: payload.userId,
            token_hash: (0, jwt_1.hashToken)(newRefresh),
            expires_at: (0, jwt_1.refreshTokenExpiry)(),
        },
    });
    res.json({ accessToken: newAccess, refreshToken: newRefresh });
}
async function logout(req, res) {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        res.status(400).json({ error: 'refreshToken required' });
        return;
    }
    await prisma_1.default.refreshToken.deleteMany({
        where: { user_id: req.user.userId, token_hash: (0, jwt_1.hashToken)(refreshToken) },
    });
    res.json({ message: 'Logged out' });
}
async function me(req, res) {
    const user = await prisma_1.default.user.findUnique({
        where: { id: req.user.userId },
        include: { profile: true, user_roles: true },
    });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json({
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        about: user.about,
        gender: user.gender,
        profile_picture: user.profile_picture,
        roles: user.user_roles.map((r) => r.role),
        profile: (0, serialize_1.jsonSafe)(user.profile),
    });
}
async function changePassword(req, res) {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;
    try {
        const user = await prisma_1.default.user.findUnique({ where: { id: userId } });
        if (!user || !user.password_hash) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(currentPassword, user.password_hash);
        if (!valid) {
            res.status(401).json({ error: 'Current password is incorrect' });
            return;
        }
        const newHash = await bcryptjs_1.default.hash(newPassword, 10);
        await prisma_1.default.user.update({ where: { id: userId }, data: { password_hash: newHash } });
        // Revoke all refresh tokens so other devices must re-login
        await prisma_1.default.refreshToken.deleteMany({ where: { user_id: userId } });
        log(`[CHANGE-PASSWORD] Success — userId: ${userId}`);
        res.json({ message: 'Password updated successfully' });
    }
    catch (err) {
        console.error('[CHANGE-PASSWORD] Failed', err);
        res.status(500).json({ error: 'Failed to update password' });
    }
}
/**
 * Send OTP for password reset
 */
async function sendPasswordResetOTP(req, res) {
    const { phone } = req.body;
    if (!phone) {
        res.status(400).json({ error: 'Phone number is required' });
        return;
    }
    const normalizedPhone = (0, phone_1.normalizePhone)(phone);
    log(`[FORGOT-PASSWORD] OTP request for phone: ${phone} → normalized: ${normalizedPhone}`);
    try {
        const variants = (0, phone_1.phoneVariants)(phone);
        const user = await prisma_1.default.user.findFirst({
            where: {
                OR: variants.map((p) => ({ phone: p })),
            },
        });
        if (!user) {
            log(`[FORGOT-PASSWORD] User not found for ${normalizedPhone}`);
            res.status(404).json({ error: 'Phone number not registered. Please sign up first.' });
            return;
        }
        const otp = (0, otp_1.generateOTP)();
        (0, otp_1.storeOTP)(normalizedPhone, otp);
        await (0, otp_1.sendOTP)(normalizedPhone, otp);
        log(`[FORGOT-PASSWORD] OTP sent to ${normalizedPhone}`);
        res.json({ message: 'OTP sent successfully' });
    }
    catch (err) {
        console.error('[FORGOT-PASSWORD] Failed to send OTP', err);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
}
/**
 * Verify OTP for password reset
 */
async function verifyPasswordResetOTP(req, res) {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
        res.status(400).json({ error: 'Phone number and OTP are required' });
        return;
    }
    const normalizedPhone = (0, phone_1.normalizePhone)(phone);
    log(`[FORGOT-PASSWORD] OTP verification for ${normalizedPhone}`);
    // Don't consume OTP here — resetPassword will consume it
    const isValid = (0, otp_1.verifyOTP)(normalizedPhone, otp, false);
    if (!isValid) {
        warn(`[FORGOT-PASSWORD] Invalid or expired OTP for ${normalizedPhone}`);
        res.status(401).json({ error: 'Invalid or expired OTP' });
        return;
    }
    log(`[FORGOT-PASSWORD] OTP verified for ${normalizedPhone}`);
    res.json({ message: 'OTP verified successfully' });
}
/**
 * Reset password after OTP verification
 */
async function resetPassword(req, res) {
    const { phone, otp, newPassword } = req.body;
    if (!phone || !otp || !newPassword) {
        res.status(400).json({ error: 'Phone number, OTP, and new password are required' });
        return;
    }
    if (newPassword.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
        return;
    }
    const normalizedPhone = (0, phone_1.normalizePhone)(phone);
    log(`[FORGOT-PASSWORD] Password reset for ${normalizedPhone}`);
    // Verify OTP again before allowing password reset
    const isValid = (0, otp_1.verifyOTP)(normalizedPhone, otp);
    if (!isValid) {
        warn(`[FORGOT-PASSWORD] Invalid or expired OTP for ${normalizedPhone}`);
        res.status(401).json({ error: 'Invalid or expired OTP' });
        return;
    }
    try {
        const variants = (0, phone_1.phoneVariants)(phone);
        const user = await prisma_1.default.user.findFirst({
            where: {
                OR: variants.map((p) => ({ phone: p })),
            },
        });
        if (!user) {
            warn(`[FORGOT-PASSWORD] User not found for ${normalizedPhone}`);
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const newHash = await bcryptjs_1.default.hash(newPassword, 10);
        await prisma_1.default.user.update({
            where: { id: user.id },
            data: { password_hash: newHash }
        });
        // Revoke all refresh tokens for security
        await prisma_1.default.refreshToken.deleteMany({ where: { user_id: user.id } });
        log(`[FORGOT-PASSWORD] Password reset successful for userId: ${user.id}`);
        res.json({ message: 'Password reset successfully' });
    }
    catch (err) {
        console.error('[FORGOT-PASSWORD] Failed to reset password', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
}
//# sourceMappingURL=authController.js.map