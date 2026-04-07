import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env') });

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

async function checkAds() {
  const approved = await prisma.adCampaign.count({
    where: { approval_status: 'approved' }
  });
  console.log('✅ Total approved campaigns:', approved);

  const active = await prisma.adCampaign.count({
    where: { status: 'active' }
  });
  console.log('✅ Total active campaigns:', active);

  const validDates = await prisma.adCampaign.count({
    where: {
      status: 'active',
      approval_status: 'approved',
      OR: [
        { end_date: null },
        { end_date: { gte: new Date() } }
      ]
    }
  });
  console.log('✅ Valid (active + approved + valid dates):', validDates);

  // Check what's filtering them out
  const expired = await prisma.adCampaign.count({
    where: {
      status: 'active',
      approval_status: 'approved',
      end_date: { lt: new Date() }
    }
  });
  console.log('❌ Expired (past end_date):', expired);

  // Sample campaigns with dates
  console.log('\n📋 Sample approved campaigns:');
  const samples = await prisma.adCampaign.findMany({
    where: { approval_status: 'approved' },
    select: { id: true, title: true, status: true, end_date: true },
    take: 5
  });
  samples.forEach((c: any) => {
    const now = new Date();
    const endDate = new Date(c.end_date!);
    const isExpired = endDate < now;
    console.log(`  #${c.id}: "${c.title}" | status=${c.status} | end=${c.end_date} ${isExpired ? '❌ EXPIRED' : '✅ VALID'}`);
  });
}

checkAds().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
