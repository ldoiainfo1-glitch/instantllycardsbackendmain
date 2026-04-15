/**
 * Backfill tier field for existing BusinessPromotion records.
 *
 * Logic:
 * - Find promotions with tier = 'free' that have a paid PromotionOrder
 * - Look up the rank_label from the most recent order
 * - Map rank_label to tier (GROWTH→growth, BOOST→boost, SCALE/DOMINATE→scale)
 * - Also ensure every user with a promotion has the business role
 *
 * Run: npx ts-node scripts/backfillTiers.ts
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const needsSsl =
  /supabase\.com|pooler\.supabase\.com/i.test(databaseUrl) ||
  /sslmode=require/i.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

function rankLabelToTier(rankLabel: string | null | undefined): string {
  if (!rankLabel) return 'free';
  const label = rankLabel.toUpperCase();
  if (label === 'GROWTH') return 'growth';
  if (label === 'BOOST') return 'boost';
  if (label === 'SCALE' || label === 'DOMINATE') return 'scale';
  return 'free';
}

async function main() {
  console.log('=== Backfill Tier + Business Role ===\n');

  // 1. Find premium promotions with tier still set to 'free'
  const promos = await prisma.businessPromotion.findMany({
    where: {
      plan_type: 'premium',
      tier: 'free',
    },
    select: { id: true, user_id: true },
  });

  console.log(`Found ${promos.length} premium promotions with tier='free'\n`);

  let tierUpdated = 0;
  for (const promo of promos) {
    // Find the most recent completed order for this promotion
    const order = await prisma.promotionOrder.findFirst({
      where: {
        business_promotion_id: promo.id,
        payment_status: 'captured',
      },
      orderBy: { created_at: 'desc' },
      select: { rank_label: true },
    });

    if (order) {
      const tier = rankLabelToTier(order.rank_label);
      if (tier !== 'free') {
        await prisma.businessPromotion.update({
          where: { id: promo.id },
          data: { tier },
        });
        tierUpdated++;
        console.log(`  Promo #${promo.id} → tier: ${tier} (from rank_label: ${order.rank_label})`);
      }
    }
  }
  console.log(`\nUpdated tier for ${tierUpdated} promotions\n`);

  // 2. Ensure every user with a promotion has the business role
  const allPromoUsers = await prisma.businessPromotion.findMany({
    select: { user_id: true },
    distinct: ['user_id'],
  });

  let rolesCreated = 0;
  for (const { user_id } of allPromoUsers) {
    const existing = await prisma.userRole.findFirst({
      where: { user_id, role: 'business' },
    });
    if (!existing) {
      await prisma.userRole.create({
        data: { user_id, role: 'business' },
      });
      rolesCreated++;
      console.log(`  User #${user_id} → granted business role`);
    }
  }
  console.log(`\nCreated business role for ${rolesCreated} users\n`);

  console.log('=== Done ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
