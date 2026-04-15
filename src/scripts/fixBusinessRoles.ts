/**
 * One-time migration: Fix users with premium promotions but no business role.
 *
 * Finds users who have at least one BusinessPromotion with plan_type='premium'
 * (any status — active, expired, pending_payment) but are missing the 'business'
 * role in the UserRole table, and inserts the missing role.
 *
 * Safe to re-run (uses upsert to avoid duplicates).
 *
 * Usage: npx ts-node src/scripts/fixBusinessRoles.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('🔍 Finding users with premium promotions but missing business role...');

  // All user_ids that have a premium promotion
  const premiumPromos = await prisma.businessPromotion.findMany({
    where: { plan_type: 'premium' },
    select: { user_id: true },
    distinct: ['user_id'],
  });

  const premiumUserIds = premiumPromos.map((p: any) => p.user_id).filter(Boolean) as number[];
  console.log(`📋 Found ${premiumUserIds.length} users with premium promotions`);

  if (premiumUserIds.length === 0) {
    console.log('✅ No users to fix');
    return;
  }

  // Find which of those already have the business role
  const existingBusinessRoles = await prisma.userRole.findMany({
    where: { user_id: { in: premiumUserIds }, role: 'business' },
    select: { user_id: true },
  });
  const alreadyHaveRole = new Set(existingBusinessRoles.map((r: any) => r.user_id));

  const missingRoleUserIds = premiumUserIds.filter((id) => !alreadyHaveRole.has(id));
  console.log(`⚠️  ${missingRoleUserIds.length} users are missing the business role`);

  if (missingRoleUserIds.length === 0) {
    console.log('✅ All premium users already have the business role');
    return;
  }

  // Insert missing business roles
  let fixed = 0;
  for (const userId of missingRoleUserIds) {
    await prisma.userRole.upsert({
      where: { user_id_role: { user_id: userId, role: 'business' } },
      update: {},
      create: { user_id: userId, role: 'business' },
    });
    fixed++;
    console.log(`  ✅ Granted business role to userId: ${userId}`);
  }

  console.log(`\n🎉 Done — fixed ${fixed} user(s)`);
}

main()
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
