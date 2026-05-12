/**
 * Import 32000_Tier-1.csv into BusinessPromotion under user_id = 754.
 *
 *   - status = 'active' (equivalent of "approved + live" for promotions)
 *   - listing_type / tier / plan_type / payment_status = free defaults
 *   - business_card_id = null
 *   - category[] = [normalized Main, normalized Sub] using exact casing from Category table
 *
 * Cleans the messy "Locality" field (strips replacement chars + the
 * "Open / Closes" timing strings) and stores the remainder in `area`.
 *
 * Idempotent: skips rows whose (phone + business_name) already exist for
 * user 754 — safe to re-run.
 *
 * Set DRY_RUN=1 to insert nothing (just print what would happen).
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const SEED_USER_ID = 754;
const BATCH_SIZE = 1000;
const CSV_PATH = path.resolve(__dirname, '..', '..', '32000_Tier-1.csv');
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const databaseUrl = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: /supabase|sslmode=require/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

function cleanLocality(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // Strip Unicode replacement char (broken UTF-8 from scraping)
  s = s.replace(/\uFFFD/g, ' ');
  // Strip common timing fragments inserted by the scraper
  s = s.replace(/\bClos(es|ed)\b[^,]*?(am|pm)\b/gi, ' ');
  s = s.replace(/\bOpens?\b[^,]*?(am|pm)\b/gi, ' ');
  s = s.replace(/\bOpen 24 hours\b/gi, ' ');
  s = s.replace(/\bOpens?\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Strip leading punctuation/commas left behind
  s = s.replace(/^[,\s.\-]+/, '').replace(/[,\s.\-]+$/, '');
  return s;
}

async function main() {
  console.log(`Database: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Seed user_id: ${SEED_USER_ID}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  // Verify user exists
  const user = await prisma.user.findUnique({ where: { id: SEED_USER_ID } });
  if (!user) throw new Error(`User #${SEED_USER_ID} not found`);

  // Build category name map (lowercase -> exact db casing)
  const cats = await prisma.category.findMany({ where: { is_active: true }, select: { name: true } });
  const catMap = new Map<string, string>();
  for (const c of cats) catMap.set(c.name.trim().toLowerCase(), c.name);
  console.log(`Loaded ${cats.length} active categories.`);

  // Parse CSV
  const buf = fs.readFileSync(CSV_PATH);
  const csvRows: any[] = parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  });
  console.log(`CSV rows: ${csvRows.length}`);

  // Pre-fetch existing (phone + business_name) for idempotency
  const existing = await prisma.businessPromotion.findMany({
    where: { user_id: SEED_USER_ID },
    select: { phone: true, business_name: true },
  });
  const seenKey = new Set<string>();
  for (const e of existing) seenKey.add(`${e.phone}|${(e.business_name || '').toLowerCase()}`);
  console.log(`Existing promotions for user ${SEED_USER_ID}: ${existing.length}\n`);

  // Build insert payloads
  const payloads: Prisma.BusinessPromotionCreateManyInput[] = [];
  const stats = {
    parsed: 0, skipped_duplicate_in_csv: 0, skipped_existing_db: 0,
    skipped_missing_data: 0, skipped_unknown_category: 0, prepared: 0,
  };
  const dedupCsv = new Set<string>();

  for (const r of csvRows) {
    stats.parsed++;
    const name = (r['Name'] || '').trim();
    const phone = (r['Mobile no'] || '').trim();
    const mainRaw = (r['Main Category'] || '').trim();
    const subRaw = (r['Sub Category'] || '').trim();
    const city = (r['City'] || '').trim() || null;
    const localityRaw = (r['Locality'] || '').trim();

    if (!name || !phone || !mainRaw) { stats.skipped_missing_data++; continue; }

    const mainNorm = catMap.get(mainRaw.toLowerCase());
    if (!mainNorm) { stats.skipped_unknown_category++; continue; }
    const subNorm = subRaw ? catMap.get(subRaw.toLowerCase()) : undefined;

    const csvKey = `${phone}|${name.toLowerCase()}`;
    if (dedupCsv.has(csvKey)) { stats.skipped_duplicate_in_csv++; continue; }
    dedupCsv.add(csvKey);
    if (seenKey.has(csvKey)) { stats.skipped_existing_db++; continue; }

    const categories = subNorm ? [mainNorm, subNorm] : [mainNorm];
    const area = cleanLocality(localityRaw) || null;

    payloads.push({
      user_id: SEED_USER_ID,
      business_card_id: null,
      business_name: name,
      owner_name: name,
      description: null,
      category: categories,
      phone,
      whatsapp: phone,
      area,
      city,
      status: 'active',
      listing_type: 'free',
      listing_intent: 'free',
      plan_type: 'free',
      tier: 'free',
      payment_status: 'not_required',
      visibility_priority_score: 10,
      expiry_date: null,
    });
    stats.prepared++;
  }

  console.log('Preparation summary:');
  console.log(`  parsed:                  ${stats.parsed}`);
  console.log(`  skipped (missing data):  ${stats.skipped_missing_data}`);
  console.log(`  skipped (unknown cat):   ${stats.skipped_unknown_category}`);
  console.log(`  skipped (csv dup):       ${stats.skipped_duplicate_in_csv}`);
  console.log(`  skipped (already in db): ${stats.skipped_existing_db}`);
  console.log(`  ready to insert:         ${stats.prepared}\n`);

  if (DRY_RUN) {
    console.log('DRY_RUN=1 — exiting without writes.');
    console.log('\nFirst 3 prepared payloads:');
    payloads.slice(0, 3).forEach((p, i) => console.log(`#${i+1}`, p));
    return;
  }
  if (payloads.length === 0) {
    console.log('Nothing to insert.');
    return;
  }

  // Bulk insert in batches
  let inserted = 0;
  const tStart = Date.now();
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const chunk = payloads.slice(i, i + BATCH_SIZE);
    const t0 = Date.now();
    const result = await prisma.businessPromotion.createMany({ data: chunk, skipDuplicates: true });
    inserted += result.count;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(payloads.length / BATCH_SIZE)}: inserted ${result.count} (running ${inserted}, ${Date.now() - t0}ms)`);
  }
  console.log(`\nDone. Inserted ${inserted} rows in ${((Date.now() - tStart) / 1000).toFixed(1)}s.`);

  const finalCount = await prisma.businessPromotion.count({ where: { user_id: SEED_USER_ID } });
  console.log(`Total BusinessPromotion rows now under user ${SEED_USER_ID}: ${finalCount}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
