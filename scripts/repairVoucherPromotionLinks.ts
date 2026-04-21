import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../src/utils/prisma';

type RepairLog = {
  voucher_id: number;
  action: 'linked_existing' | 'created_fallback_promotion' | 'linked_fallback_promotion' | 'unresolved';
  reason?: string;
  business_id: number | null;
  owner_user_id: number | null;
  business_promotion_id?: number;
};

async function findMatchingPromotion(voucher: { business_id: number | null; owner_user_id: number | null; business_name: string | null }) {
  if (voucher.business_id) {
    const exactByCard = await prisma.businessPromotion.findFirst({
      where: { business_card_id: voucher.business_id },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (exactByCard) return exactByCard.id;
  }

  if (voucher.owner_user_id) {
    const byOwnerAndName = await prisma.businessPromotion.findFirst({
      where: {
        user_id: voucher.owner_user_id,
        business_name: voucher.business_name ?? undefined,
      },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (byOwnerAndName) return byOwnerAndName.id;

    const byOwnerAny = await prisma.businessPromotion.findFirst({
      where: { user_id: voucher.owner_user_id },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (byOwnerAny) return byOwnerAny.id;
  }

  return null;
}

async function createFallbackPromotion(voucher: { owner_user_id: number; business_name: string | null; business_id: number | null }) {
  const owner = await prisma.user.findUnique({
    where: { id: voucher.owner_user_id },
    select: { name: true, phone: true },
  });

  const promotion = await prisma.businessPromotion.create({
    data: {
      user_id: voucher.owner_user_id,
      business_name: voucher.business_name || `Migrated Business ${voucher.owner_user_id}`,
      owner_name: owner?.name || owner?.phone || `User ${voucher.owner_user_id}`,
      business_card_id: voucher.business_id ?? undefined,
      listing_type: 'free',
      listing_intent: 'free',
      plan_type: 'free',
      tier: 'free',
      status: 'active',
      payment_status: 'not_required',
    },
    select: { id: true },
  });

  return promotion.id;
}

async function main() {
  const unresolvedBefore = await prisma.$queryRaw<Array<{
    id: number;
    business_id: number | null;
    owner_user_id: number | null;
    original_owner_id: number | null;
    created_by_admin_id: number | null;
    transferred_from_id: number | null;
    business_name: string | null;
  }>>`
    SELECT
      id,
      business_id,
      owner_user_id,
      original_owner_id,
      created_by_admin_id,
      transferred_from_id,
      business_name
    FROM "Voucher"
    WHERE business_promotion_id IS NULL
    ORDER BY id ASC
  `;

  const logs: RepairLog[] = [];
  let linked = 0;
  let createdPromotions = 0;

  for (const v of unresolvedBefore) {
    const candidateOwner = v.owner_user_id ?? v.original_owner_id ?? v.created_by_admin_id ?? v.transferred_from_id;

    const existing = await findMatchingPromotion({
      business_id: v.business_id,
      owner_user_id: candidateOwner,
      business_name: v.business_name,
    });

    if (existing) {
      await prisma.voucher.update({
        where: { id: v.id },
        data: { business_promotion_id: existing },
      });
      linked += 1;
      logs.push({
        voucher_id: v.id,
        action: 'linked_existing',
        business_id: v.business_id,
        owner_user_id: candidateOwner,
        business_promotion_id: existing,
      });
      continue;
    }

    if (!candidateOwner) {
      logs.push({
        voucher_id: v.id,
        action: 'unresolved',
        reason: 'no_owner_fields_present',
        business_id: v.business_id,
        owner_user_id: null,
      });
      continue;
    }

    const fallbackPromotionId = await createFallbackPromotion({
      owner_user_id: candidateOwner,
      business_name: v.business_name,
      business_id: v.business_id,
    });
    createdPromotions += 1;

    logs.push({
      voucher_id: v.id,
      action: 'created_fallback_promotion',
      business_id: v.business_id,
      owner_user_id: candidateOwner,
      business_promotion_id: fallbackPromotionId,
    });

    await prisma.voucher.update({
      where: { id: v.id },
      data: { business_promotion_id: fallbackPromotionId },
    });
    linked += 1;

    logs.push({
      voucher_id: v.id,
      action: 'linked_fallback_promotion',
      business_id: v.business_id,
      owner_user_id: candidateOwner,
      business_promotion_id: fallbackPromotionId,
    });
  }

  const unresolvedAfter = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "Voucher"
    WHERE business_promotion_id IS NULL
  `;

  const logDir = path.resolve(process.cwd(), 'migration_logs');
  await fs.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, 'voucher_promotion_repair.jsonl');
  const content = logs.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(logFile, content ? `${content}\n` : '', 'utf8');

  console.log('[VOUCHER-REPAIR] scanned:', unresolvedBefore.length);
  console.log('[VOUCHER-REPAIR] linked:', linked);
  console.log('[VOUCHER-REPAIR] fallback_promotions_created:', createdPromotions);
  console.log('[VOUCHER-REPAIR] unresolved_after:', Number(unresolvedAfter[0]?.count ?? 0n));
  console.log('[VOUCHER-REPAIR] log:', logFile);
}

main()
  .catch((err) => {
    console.error('[VOUCHER-REPAIR] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
