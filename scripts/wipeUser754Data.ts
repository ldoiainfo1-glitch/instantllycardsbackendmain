/**
 * Wipes all BusinessPromotion and BusinessCard rows owned by user #754
 * ("Instantlly Official" — seed/import user). Keeps the user itself.
 *
 * Cascade behavior (per schema.prisma):
 *   - BusinessPromotion delete -> cascades into vouchers, leads, events,
 *     enquiries, promotion_orders; SetNull into bookings/reviews.
 *   - BusinessCard delete    -> cascades into BusinessCardCategory, phones,
 *     locations, photos, staff, analytics, shares, favorites, leads,
 *     reviews, vouchers, ads, ad_campaigns, events, bookings (those that
 *     reference business_id with cascade).
 *
 * Deletes in 5k batches in separate small transactions to avoid Supabase
 * statement timeouts. Set DRY_RUN=1 to preview only.
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const TARGET_USER_ID = 754;
const BATCH_SIZE = 5000;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const dbUrl: string = databaseUrl;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: /supabase|sslmode=require/i.test(dbUrl) ? { rejectUnauthorized: false } : undefined,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

async function batchDelete(tableName: string, userId: number): Promise<number> {
  let totalDeleted = 0;
  let pass = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    pass++;
    const t0 = Date.now();
    const n: number = await prisma.$executeRawUnsafe(
      `DELETE FROM "${tableName}"
        WHERE id IN (
          SELECT id FROM "${tableName}"
          WHERE user_id = $1
          LIMIT ${BATCH_SIZE}
        )`,
      userId
    );
    totalDeleted += n;
    const ms = Date.now() - t0;
    console.log(`  [${tableName}] pass #${pass}: deleted ${n} (running total ${totalDeleted}, ${ms}ms)`);
    if (n === 0 || n < BATCH_SIZE) break;
  }
  return totalDeleted;
}

async function main() {
  console.log(`Database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Target user_id: ${TARGET_USER_ID}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  const user = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, email FROM "User" WHERE id = $1`, TARGET_USER_ID
  );
  if (user.length === 0) throw new Error(`User #${TARGET_USER_ID} not found`);
  console.log(`Confirmed seed user: #${user[0].id} ${user[0].name} <${user[0].email}>\n`);

  // Counts before
  const before = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      (SELECT COUNT(*)::int FROM "BusinessPromotion" WHERE user_id = $1) AS promos,
      (SELECT COUNT(*)::int FROM "BusinessCard"      WHERE user_id = $1) AS cards
  `, TARGET_USER_ID);
  console.log(`Before: BusinessPromotion=${before[0].promos}, BusinessCard=${before[0].cards}`);

  if (DRY_RUN) {
    console.log('\nDRY_RUN=1 — exiting without changes.');
    return;
  }

  console.log('\nDeleting BusinessPromotion rows (cascades into vouchers/leads/events/enquiries)...');
  const delPromos = await batchDelete('BusinessPromotion', TARGET_USER_ID);
  console.log(`Done. Deleted ${delPromos} BusinessPromotion rows.\n`);

  console.log('Deleting BusinessCard rows (cascades into categories/phones/locations/photos/etc)...');
  const delCards = await batchDelete('BusinessCard', TARGET_USER_ID);
  console.log(`Done. Deleted ${delCards} BusinessCard rows.\n`);

  const after = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      (SELECT COUNT(*)::int FROM "BusinessPromotion" WHERE user_id = $1) AS promos,
      (SELECT COUNT(*)::int FROM "BusinessCard"      WHERE user_id = $1) AS cards
  `, TARGET_USER_ID);
  console.log(`After: BusinessPromotion=${after[0].promos}, BusinessCard=${after[0].cards}`);

  const userStill = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, email FROM "User" WHERE id = $1`, TARGET_USER_ID
  );
  console.log(`User #${TARGET_USER_ID} still present: ${userStill.length === 1 ? 'YES' : 'NO'}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
