import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Clears device-local URIs (file://, content://, ph://, data:) from
// vouchers.voucher_image / voucher_banner so other users don't see broken
// images. Such URIs only render on the device that uploaded them.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const needsSsl =
  /supabase\.com|pooler\.supabase\.com/i.test(databaseUrl) ||
  /sslmode=require/i.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const BAD_RE = /^(file:|content:|ph:|data:)/i;

async function main() {
  // Discover the actual table name (some envs have "Voucher", some "vouchers")
  const tables = await prisma.$queryRawUnsafe<any[]>(
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'voucher_image' AND table_schema = 'public'`
  );
  if (tables.length === 0) {
    console.log('No table with column voucher_image found in public schema');
    return;
  }
  const tableName = tables[0].table_name as string;
  console.log(`Using table: "${tableName}"`);

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, voucher_image, voucher_banner
     FROM "${tableName}"
     WHERE voucher_image ~* '^(file:|content:|ph:|data:)'
        OR voucher_banner ~* '^(file:|content:|ph:|data:)'`
  );
  console.log(`Found ${rows.length} voucher(s) with local-only image URIs`);

  let cleared = 0;
  for (const r of rows) {
    const sets: string[] = [];
    if (r.voucher_image && BAD_RE.test(r.voucher_image)) sets.push('voucher_image = NULL');
    if (r.voucher_banner && BAD_RE.test(r.voucher_banner)) sets.push('voucher_banner = NULL');
    if (sets.length === 0) continue;
    console.log(`  #${r.id} ${r.title} -> ${sets.join(', ')}`);
    await prisma.$executeRawUnsafe(
      `UPDATE "${tableName}" SET ${sets.join(', ')} WHERE id = $1`,
      r.id
    );
    cleared++;
  }
  console.log(`Cleared image fields on ${cleared} voucher(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
