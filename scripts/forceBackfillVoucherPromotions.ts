import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../src/utils/prisma';

type LegacyVoucher = {
  id: number;
  business_id: number | null;
  business_name: string | null;
};

type CreatedPromotionInfo = {
  key: string;
  promotion_id: number;
  business_id: number | null;
  business_name: string;
};

async function getFallbackUserId(): Promise<number> {
  const admin = await prisma.userRole.findFirst({
    where: { role: 'admin' },
    select: { user_id: true },
    orderBy: { user_id: 'asc' },
  });
  if (admin?.user_id) return admin.user_id;

  const firstUser = await prisma.user.findFirst({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (!firstUser) {
    throw new Error('No users found in database. Cannot assign fallback promotions.');
  }
  return firstUser.id;
}

async function hasBusinessCard(cardId: number): Promise<boolean> {
  const card = await prisma.businessCard.findUnique({
    where: { id: cardId },
    select: { id: true },
  });
  return Boolean(card);
}

async function main() {
  const unresolved = await prisma.$queryRaw<LegacyVoucher[]>`
    SELECT id, business_id, business_name
    FROM "Voucher"
    WHERE business_promotion_id IS NULL
    ORDER BY id ASC
  `;

  if (unresolved.length === 0) {
    console.log('[FORCE-BACKFILL] No unresolved vouchers. Nothing to do.');
    return;
  }

  const fallbackUserId = await getFallbackUserId();

  const createdPromotions: CreatedPromotionInfo[] = [];
  const cache = new Map<string, number>();
  let linked = 0;

  for (const voucher of unresolved) {
    const cleanName = (voucher.business_name || 'Migrated Legacy Voucher').trim();
    const key = voucher.business_id ? `card:${voucher.business_id}` : `name:${cleanName.toLowerCase()}`;

    let promotionId = cache.get(key) ?? null;

    if (!promotionId) {
      let existing = null as null | { id: number };

      if (voucher.business_id) {
        existing = await prisma.businessPromotion.findFirst({
          where: { business_card_id: voucher.business_id },
          select: { id: true },
          orderBy: { created_at: 'desc' },
        });
      }

      if (!existing) {
        existing = await prisma.businessPromotion.findFirst({
          where: {
            user_id: fallbackUserId,
            business_card_id: null,
            business_name: cleanName,
          },
          select: { id: true },
          orderBy: { created_at: 'desc' },
        });
      }

      if (existing) {
        promotionId = existing.id;
      } else {
        const businessCardId = voucher.business_id && (await hasBusinessCard(voucher.business_id))
          ? voucher.business_id
          : null;

        const created = await prisma.businessPromotion.create({
          data: {
            user_id: fallbackUserId,
            business_card_id: businessCardId ?? undefined,
            business_name: cleanName,
            owner_name: `Legacy Migration (User ${fallbackUserId})`,
            listing_type: 'free',
            listing_intent: 'free',
            plan_type: 'free',
            tier: 'free',
            status: 'active',
            payment_status: 'not_required',
          },
          select: { id: true },
        });

        promotionId = created.id;
        createdPromotions.push({
          key,
          promotion_id: created.id,
          business_id: businessCardId,
          business_name: cleanName,
        });
      }

      cache.set(key, promotionId);
    }

    await prisma.voucher.update({
      where: { id: voucher.id },
      data: { business_promotion_id: promotionId },
    });
    linked += 1;
  }

  const [remaining] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "Voucher"
    WHERE business_promotion_id IS NULL
  `;

  const logDir = path.resolve(process.cwd(), 'migration_logs');
  await fs.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, 'voucher_force_backfill_created_promotions.json');
  await fs.writeFile(
    logFile,
    JSON.stringify(
      {
        fallbackUserId,
        createdCount: createdPromotions.length,
        linkedCount: linked,
        remainingWithoutPromotion: Number(remaining?.count ?? 0n),
        createdPromotions,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('[FORCE-BACKFILL] fallback_user_id:', fallbackUserId);
  console.log('[FORCE-BACKFILL] linked:', linked);
  console.log('[FORCE-BACKFILL] created_promotions:', createdPromotions.length);
  console.log('[FORCE-BACKFILL] remaining_without_promotion:', Number(remaining?.count ?? 0n));
  console.log('[FORCE-BACKFILL] log:', logFile);
}

main()
  .catch((err) => {
    console.error('[FORCE-BACKFILL] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
