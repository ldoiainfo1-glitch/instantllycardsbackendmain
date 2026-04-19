import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt } from '../utils/params';
import { jsonSafe } from '../utils/serialize';
import { normalizePhone } from '../utils/phone';

export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { profile: true, user_roles: true },
    omit: { password_hash: true } as any,
  });
  if (!user) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(jsonSafe(user));
}

export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  const { name, about, gender, profile_picture, phone } = req.body;
  const userId = req.user!.userId;
  const updateData: any = { name, about, gender, profile_picture };

  if (phone) {
    const normalizedPhone = String(phone).trim();
    const existing = await prisma.user.findFirst({
      where: { phone: normalizedPhone, id: { not: userId } },
    });
    if (existing) {
      res.status(409).json({ error: 'Phone already in use' });
      return;
    }
    updateData.phone = normalizedPhone;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  await prisma.profile.upsert({
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

export async function updatePushToken(req: AuthRequest, res: Response): Promise<void> {
  const { pushToken } = req.body;
  const userId = req.user!.userId;

  if (!pushToken || typeof pushToken !== 'string') {
    res.status(400).json({ error: 'pushToken is required' });
    return;
  }

  // Only accept Expo push tokens
  if (!pushToken.startsWith('ExponentPushToken[')) {
    res.status(400).json({ error: 'Invalid push token format' });
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { push_token: pushToken, push_token_updated_at: new Date() },
  });

  res.json({ message: 'Push token updated' });
}

export async function getUserById(req: AuthRequest, res: Response): Promise<void> {
  const userId = paramInt(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, user_roles: true, business_cards: { take: 5 } },
    omit: { password_hash: true } as any,
  });
  if (!user) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(jsonSafe(user));
}
export async function getUserLocation(req: AuthRequest, res: Response): Promise<void> {
  const location = await prisma.userLocation.findUnique({
    where: { user_id: req.user!.userId },
  });
  res.json(jsonSafe(location ?? {}));
}

export async function upsertUserLocation(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const data: any = {};
  if (req.body?.current_location !== undefined) data.current_location = req.body.current_location;
  if (req.body?.address !== undefined) data.address = req.body.address;
  if (req.body?.accuracy !== undefined) data.accuracy = req.body.accuracy;
  if (req.body?.radius !== undefined) data.radius = req.body.radius;
  if (req.body?.is_location_enabled !== undefined) data.is_location_enabled = Boolean(req.body.is_location_enabled);
  if (req.body?.share_location_with !== undefined) data.share_location_with = String(req.body.share_location_with);
  data.last_updated = new Date();

  const location = await prisma.userLocation.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...data },
    update: data,
  });

  res.json(jsonSafe(location));
}

export async function matchContacts(req: AuthRequest, res: Response): Promise<void> {
  const { phones } = req.body;
  if (!Array.isArray(phones) || phones.length === 0) {
    res.status(400).json({ error: 'phones array required' });
    return;
  }

  // Use the same normalizePhone used during registration so formats always match
  const cleaned = [...new Set(
    phones.slice(0, 500)
      .map((p: any) => normalizePhone(String(p).trim()))
      .filter(p => p.length >= 7)
  )];

  if (cleaned.length === 0) {
    res.json([]);
    return;
  }

  // Query all variants so we match regardless of how the number was stored
  const variants: string[] = [];
  for (const p of cleaned) {
    variants.push(p);
    variants.push(`+91${p}`);
    variants.push(`91${p}`);
    variants.push(`0${p}`);
  }

  console.log(`[matchContacts] querying ${cleaned.length} unique phones (${variants.length} variants)`);

  const users = await prisma.user.findMany({
    where: { phone: { in: variants } },
    select: { id: true, name: true, phone: true, profile_picture: true },
  });

  console.log(`[matchContacts] found ${users.length} app users`);
  users.forEach(u => console.log('  matched:', u.id, u.phone));

  res.json(users);
}

export async function deleteMe(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  try {
    const anonymized = `deleted_${userId}_${Date.now()}`;
    await prisma.$transaction(async (tx) => {
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
  } catch (err) {
    console.error('[DELETE-ACCOUNT] Failed', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
}

