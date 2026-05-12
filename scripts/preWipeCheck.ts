import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: /supabase|sslmode=require/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

async function main() {
  const v = await prisma.$queryRawUnsafe<any[]>(`
    SELECT v.id, v.title,
           v.business_id, bc.user_id AS card_owner_id,
           v.business_promotion_id, bp.user_id AS promo_owner_id
    FROM "Voucher" v
    LEFT JOIN "BusinessCard" bc ON bc.id = v.business_id
    LEFT JOIN "BusinessPromotion" bp ON bp.id = v.business_promotion_id
    WHERE v.id = 90
  `);
  console.log('Bollypop voucher #90:', v[0]);

  // Are any users (besides 754) referenced by promotions owned by 754?
  const stats = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      (SELECT COUNT(*)::int FROM "BusinessPromotion" WHERE user_id = 754) AS promos_754,
      (SELECT COUNT(*)::int FROM "BusinessCard" WHERE user_id = 754) AS cards_754,
      (SELECT COUNT(*)::int FROM "Voucher" v JOIN "BusinessPromotion" bp ON bp.id = v.business_promotion_id WHERE bp.user_id = 754) AS vouchers_via_promo,
      (SELECT COUNT(*)::int FROM "Voucher" v JOIN "BusinessCard" bc ON bc.id = v.business_id WHERE bc.user_id = 754) AS vouchers_via_card,
      (SELECT COUNT(*)::int FROM "VoucherClaim" vc JOIN "Voucher" v ON v.id = vc.voucher_id JOIN "BusinessPromotion" bp ON bp.id = v.business_promotion_id WHERE bp.user_id = 754) AS claims_under_754_promos
  `);
  console.log('Counts:', stats[0]);
}

main().catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
