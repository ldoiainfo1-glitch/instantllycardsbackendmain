import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const CSV_PATH = path.resolve(__dirname, '..', '..', '32000_Tier-1.csv');

const databaseUrl = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: /supabase|sslmode=require/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

async function main() {
  const buf = fs.readFileSync(CSV_PATH);
  const rows: any[] = parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  });
  console.log(`CSV rows parsed: ${rows.length}`);
  console.log(`\nFirst row keys:`, Object.keys(rows[0] || {}));
  console.log(`\nSample rows:`);
  rows.slice(0, 3).forEach((r, i) => console.log(`#${i+1}`, r));

  const mainSet = new Set<string>();
  const subSet = new Set<string>();
  const citySet = new Set<string>();
  let missingName = 0;
  let missingPhone = 0;
  let missingMain = 0;

  for (const r of rows) {
    const main = (r['Main Category'] || '').trim();
    const sub = (r['Sub Category'] || '').trim();
    const city = (r['City'] || '').trim();
    if (main) mainSet.add(main);
    if (sub) subSet.add(sub);
    if (city) citySet.add(city);
    if (!(r['Name'] || '').trim()) missingName++;
    if (!(r['Mobile no'] || '').trim()) missingPhone++;
    if (!main) missingMain++;
  }
  console.log(`\nDistinct Main Categories: ${mainSet.size}`);
  console.log(`Distinct Sub Categories: ${subSet.size}`);
  console.log(`Distinct Cities: ${citySet.size}`);
  console.log(`Rows missing Name:  ${missingName}`);
  console.log(`Rows missing Phone: ${missingPhone}`);
  console.log(`Rows missing Main:  ${missingMain}`);

  console.log(`\nAll Main Categories from CSV:`);
  [...mainSet].sort().forEach((m) => console.log(`  - ${m}`));

  // Cross-check with existing Category table
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, parent_id, level FROM "Category" WHERE is_active = true ORDER BY level, name`
  );
  const existingNames = new Set(existing.map((c) => (c.name as string).trim().toLowerCase()));
  console.log(`\nExisting active Category rows: ${existing.length}`);

  const missingInDb = [...mainSet].filter((m) => !existingNames.has(m.toLowerCase()));
  console.log(`\nMain Categories MISSING from Category table: ${missingInDb.length}`);
  missingInDb.forEach((m) => console.log(`  - ${m}`));

  const missingSubsInDb = [...subSet].filter((s) => !existingNames.has(s.toLowerCase()));
  console.log(`\nSub Categories MISSING from Category table: ${missingSubsInDb.length}`);
  missingSubsInDb.slice(0, 30).forEach((s) => console.log(`  - ${s}`));
  if (missingSubsInDb.length > 30) console.log(`  ... and ${missingSubsInDb.length - 30} more`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
