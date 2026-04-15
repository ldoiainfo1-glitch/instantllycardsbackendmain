require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

const needsSsl = /supabase\.com|pooler\.supabase\.com/i.test(databaseUrl);
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const plans = [
    { code: 'growth_monthly', area_type: 'city', rank: 1, rank_label: 'GROWTH', amount: 1500, duration_days: 30, priority_score: 20 },
    { code: 'growth_yearly', area_type: 'city', rank: 1, rank_label: 'GROWTH', amount: 15000, duration_days: 365, priority_score: 20 },
    { code: 'boost_monthly', area_type: 'city', rank: 2, rank_label: 'BOOST', amount: 2500, duration_days: 30, priority_score: 40 },
    { code: 'boost_yearly', area_type: 'city', rank: 2, rank_label: 'BOOST', amount: 25000, duration_days: 365, priority_score: 40 },
    { code: 'scale_monthly', area_type: 'city', rank: 3, rank_label: 'SCALE', amount: 4000, duration_days: 30, priority_score: 60 },
    { code: 'scale_yearly', area_type: 'city', rank: 3, rank_label: 'SCALE', amount: 40000, duration_days: 365, priority_score: 60 },
    { code: 'dominate_monthly', area_type: 'city', rank: 4, rank_label: 'DOMINATE', amount: 5000, duration_days: 30, priority_score: 80 },
    { code: 'dominate_yearly', area_type: 'city', rank: 4, rank_label: 'DOMINATE', amount: 50000, duration_days: 365, priority_score: 80 },
  ];

  for (const p of plans) {
    await prisma.promotionPricingPlan.upsert({
      where: { code: p.code },
      update: p,
      create: p,
    });
  }

  const all = await prisma.promotionPricingPlan.findMany({ orderBy: { rank: 'asc' } });
  console.log(JSON.stringify(all, null, 2));
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
