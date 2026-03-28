/**
 * Phone Cleanup Script
 * Run ONCE to strip country codes from all phone numbers in the DB.
 *
 * Rules:
 *  - "+919373193179" → "9373193179"
 *  - "919373193179"  → "9373193179"  (starts with 91 and length > 10)
 *  - "9373193179"    → "9373193179"  (already clean, no-op)
 *
 * Safe to re-run (idempotent).
 * Usage: npx ts-node src/scripts/cleanPhones.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

function stripCountryCode(phone: string | null): string | null {
  if (!phone) return phone;
  const p = phone.trim();
  if (p.startsWith('+91')) return p.slice(3);      // +919373193179 → 9373193179
  if (p.startsWith('+')) return p.slice(1);         // other +XX → strip + only (safe fallback)
  if (p.startsWith('91') && p.length > 10) return p.slice(2); // 919373193179 → 9373193179
  return p; // already clean
}

async function main() {
  console.log('📞 Starting phone cleanup...');

  const users = await prisma.user.findMany({ select: { id: true, phone: true } });
  console.log(`👥 Total users: ${users.length}`);

  let updated = 0;
  let skipped = 0;
  let nulled = 0;

  for (const user of users) {
    const cleaned = stripCountryCode(user.phone);

    if (cleaned === user.phone) {
      skipped++;
      continue;
    }

    if (!cleaned) {
      nulled++;
      console.warn(`⚠️  User ${user.id} phone "${user.phone}" → empty after strip, skipping`);
      continue;
    }

    console.log(`  User ${user.id}: "${user.phone}" → "${cleaned}"`);
    try {
      await prisma.user.update({ where: { id: user.id }, data: { phone: cleaned } });
      updated++;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        console.warn(`  ⚠️  User ${user.id}: SKIP — "${cleaned}" already taken by another user`);
        skipped++;
      } else {
        throw err;
      }
    }
  }

  console.log('\n✅ Phone cleanup complete:');
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped (already clean): ${skipped}`);
  console.log(`   Nulled: ${nulled}`);
  console.log(`   Total: ${users.length}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
