import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL not set');

const needsSsl = /supabase|sslmode=require/i.test(databaseUrl);
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function check() {
  const nullDates = await prisma.adCampaign.count({ where: { end_date: null } });
  const pastDates = await prisma.adCampaign.count({ where: { end_date: { lt: new Date() } } });
  const futureDates = await prisma.adCampaign.count({ where: { end_date: { gte: new Date() } } });

  console.log('📊 End date distribution:');
  console.log(`  Null (never expire): ${nullDates}`);
  console.log(`  Past dates (expired): ${pastDates}`);
  console.log(`  Future dates (valid): ${futureDates}`);

  console.log('\n📅 Sample campaigns with past dates:');
  const samples = await prisma.adCampaign.findMany({
    where: { end_date: { lt: new Date() } },
    select: { id: true, title: true, end_date: true },
    take: 5,
    orderBy: { end_date: 'desc' }
  });
  samples.forEach((c: any) => {
    console.log(`  #${c.id}: ${c.title} (ends: ${c.end_date})`);
  });

  console.log('\n🔄 Would extend all campaigns by 30 days...');
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  console.log(`  New end date would be: ${futureDate}`);

  await prisma.$disconnect();
  await pool.end();
}

check();
