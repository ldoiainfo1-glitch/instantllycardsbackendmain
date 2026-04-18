import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from '../utils/jwt';
import { AuthRequest } from '../middleware/auth';
import { jsonSafe } from '../utils/serialize';
import { normalizePhone, phoneVariants } from '../utils/phone';
import { generateOTP, storeOTP, verifyOTP, sendOTP } from '../utils/otp';
import { getIO } from '../services/socketService';
import { sendExpoPushNotification } from '../utils/push';

const IS_PROD = process.env.NODE_ENV === 'production';
const log = (...args: any[]) => { if (!IS_PROD) console.log(...args); };
const warn = (...args: any[]) => { if (!IS_PROD) console.warn(...args); };

async function getUserRoles(userId: number): Promise<string[]> {
  const roles = await prisma.userRole.findMany({ where: { user_id: userId } });
  return roles.map((r) => r.role);
}

export async function signup(req: Request, res: Response): Promise<void> {
  const { phone, email, password, name, role = 'customer' } = req.body;
  const normalizedPhone = phone ? normalizePhone(phone) : phone;
  log(`[SIGNUP] Attempt — phone: ${phone} → normalized: ${normalizedPhone}, email: ${email ?? 'N/A'}, name: ${name ?? 'N/A'}, role: ${role}`);

  const validRoles = ['customer', 'business'];
  if (!validRoles.includes(role)) {
    warn(`[SIGNUP] Invalid role: ${role}`);
    res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
    return;
  }

  try {
    const variants = phone ? phoneVariants(phone) : [];
    const existing = await prisma.user.findFirst({
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

    const password_hash = await bcrypt.hash(password, 10);
    const roles = [role];

    // Atomic transaction: user + role + refresh token all succeed or all roll back
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { phone: normalizedPhone, email: email || null, password_hash, name: name || null },
      });
      log(`[SIGNUP] User created — id: ${user.id}, phone: ${user.phone}`);

      await tx.userRole.create({ data: { user_id: user.id, role } });
      log(`[SIGNUP] Role assigned — userId: ${user.id}, role: ${role}`);

      const accessToken = signAccessToken({ userId: user.id, roles });
      const refreshToken = signRefreshToken({ userId: user.id, roles });

      await tx.refreshToken.create({
        data: {
          user_id: user.id,
          token_hash: hashToken(refreshToken),
          expires_at: refreshTokenExpiry(),
        },
      });
      log(`[SIGNUP] Tokens issued — userId: ${user.id}`);

      return { user, accessToken, refreshToken };
    });

    res.status(201).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: {
        id: result.user.id,
        phone: result.user.phone,
        email: result.user.email,
        name: result.user.name,
        roles,
      },
    });

    // Send welcome notification to new user (socket — FCM token not available yet)
    try {
      const io = getIO();
      if (io) {
        io.to(`user:${result.user.id}`).emit('welcome', {
          type: 'welcome',
          title: `Welcome to Instantlly Cards! 🎉`,
          body: `Hi ${result.user.name ?? 'there'}! Your account is ready. Start exploring business cards, events & more.`,
        });
      }
    } catch { /* non-blocking */ }
  } catch (err: any) {
    if (err?.code === 'P2002') {
      warn(`[SIGNUP] Conflict (unique constraint) — ${normalizedPhone ?? email}`);
      res.status(409).json({ error: 'User with this phone/email already exists' });
      return;
    }
    console.error('[SIGNUP] Failed', err);
    res.status(500).json({ error: 'Signup failed' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const { phone, email, password, loginType } = req.body;
  log(`[LOGIN] Attempt — identifier: ${phone ?? email}, loginType: ${loginType ?? 'any'}`);

  try {
    const variants = phone ? phoneVariants(phone) : [];
    log(`[LOGIN] Phone variants to try: [${variants.join(', ')}]`);

    const user = await prisma.user.findFirst({
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

    const valid = await bcrypt.compare(password, user.password_hash);
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

    const accessToken = signAccessToken({ userId: user.id, roles });
    const refreshToken = signRefreshToken({ userId: user.id, roles });
    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        expires_at: refreshTokenExpiry(),
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
      const io = getIO();
      const welcomePayload = {
        type: 'welcome_back',
        title: `Welcome back! 👋`,
        body: `Good to see you again, ${user.name ?? 'there'}!`,
      };
      if (io) io.to(`user:${user.id}`).emit('welcome_back', welcomePayload);
      if (user.push_token) {
        sendExpoPushNotification(user.push_token, `Welcome back! 👋`, `Good to see you again, ${user.name ?? 'there'}!`, {});
      }
    } catch { /* non-blocking */ }
  } catch (err: any) {
    console.error('[LOGIN] Failed', err);
    res.status(500).json({ error: 'Login failed' });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken required' });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { user_id: payload.userId, token_hash: tokenHash },
  });
  if (!stored || stored.expires_at < new Date()) {
    res.status(401).json({ error: 'Refresh token revoked or expired' });
    return;
  }

  // Rotate: delete old, issue new (deleteMany avoids race-condition P2025)
  await prisma.refreshToken.deleteMany({ where: { id: stored.id } });

  const roles = await getUserRoles(payload.userId);
  const newAccess = signAccessToken({ userId: payload.userId, roles });
  const newRefresh = signRefreshToken({ userId: payload.userId, roles });
  await prisma.refreshToken.create({
    data: {
      user_id: payload.userId,
      token_hash: hashToken(newRefresh),
      expires_at: refreshTokenExpiry(),
    },
  });

  res.json({ accessToken: newAccess, refreshToken: newRefresh });
}

export async function logout(req: AuthRequest, res: Response): Promise<void> {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken required' });
    return;
  }
  await prisma.refreshToken.deleteMany({
    where: { user_id: req.user!.userId, token_hash: hashToken(refreshToken) },
  });
  res.json({ message: 'Logged out' });
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
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
    profile: jsonSafe(user.profile),
  });
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user!.userId;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password_hash) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: userId }, data: { password_hash: newHash } });

    // Revoke all refresh tokens so other devices must re-login
    await prisma.refreshToken.deleteMany({ where: { user_id: userId } });

    log(`[CHANGE-PASSWORD] Success — userId: ${userId}`);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('[CHANGE-PASSWORD] Failed', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
}

/**
 * Send OTP for password reset
 */
export async function sendPasswordResetOTP(req: Request, res: Response): Promise<void> {
  const { phone } = req.body;
  
  if (!phone) {
    res.status(400).json({ error: 'Phone number is required' });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  log(`[FORGOT-PASSWORD] OTP request for phone: ${phone} → normalized: ${normalizedPhone}`);

  try {
    const variants = phoneVariants(phone);
    const user = await prisma.user.findFirst({
      where: {
        OR: variants.map((p) => ({ phone: p })),
      },
    });

    if (!user) {
      log(`[FORGOT-PASSWORD] User not found for ${normalizedPhone}`);
      res.status(404).json({ error: 'Phone number not registered. Please sign up first.' });
      return;
    }

    const otp = generateOTP();
    storeOTP(normalizedPhone, otp);
    await sendOTP(normalizedPhone, otp);

    log(`[FORGOT-PASSWORD] OTP sent to ${normalizedPhone}`);
    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('[FORGOT-PASSWORD] Failed to send OTP', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
}

/**
 * Verify OTP for password reset
 */
export async function verifyPasswordResetOTP(req: Request, res: Response): Promise<void> {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    res.status(400).json({ error: 'Phone number and OTP are required' });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  log(`[FORGOT-PASSWORD] OTP verification for ${normalizedPhone}`);

  // Don't consume OTP here — resetPassword will consume it
  const isValid = verifyOTP(normalizedPhone, otp, false);

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
export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { phone, otp, newPassword } = req.body;

  if (!phone || !otp || !newPassword) {
    res.status(400).json({ error: 'Phone number, OTP, and new password are required' });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  log(`[FORGOT-PASSWORD] Password reset for ${normalizedPhone}`);

  // Verify OTP again before allowing password reset
  const isValid = verifyOTP(normalizedPhone, otp);

  if (!isValid) {
    warn(`[FORGOT-PASSWORD] Invalid or expired OTP for ${normalizedPhone}`);
    res.status(401).json({ error: 'Invalid or expired OTP' });
    return;
  }

  try {
    const variants = phoneVariants(phone);
    const user = await prisma.user.findFirst({
      where: {
        OR: variants.map((p) => ({ phone: p })),
      },
    });

    if (!user) {
      warn(`[FORGOT-PASSWORD] User not found for ${normalizedPhone}`);
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ 
      where: { id: user.id }, 
      data: { password_hash: newHash } 
    });

    // Revoke all refresh tokens for security
    await prisma.refreshToken.deleteMany({ where: { user_id: user.id } });

    log(`[FORGOT-PASSWORD] Password reset successful for userId: ${user.id}`);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('[FORGOT-PASSWORD] Failed to reset password', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}
