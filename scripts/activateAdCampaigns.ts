import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

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

async function activateAdCampaigns() {
  try {
    console.log('📊 Checking campaign status distribution...\n');

    // Count by status
    const statusCounts = await prisma.adCampaign.groupBy({
      by: ['status'],
      _count: true,
    });

    console.log('Current status distribution:');
    statusCounts.forEach((group: any) => {
      console.log(`  ${group.status}: ${group._count}`);
    });

    // Count paused campaigns
    const pausedCount = await prisma.adCampaign.count({
      where: { status: 'paused' }
    });

    if (pausedCount === 0) {
      console.log('\n✅ All campaigns already active!');
      return;
    }

    console.log(`\n⏳ Activating ${pausedCount} paused approved campaigns...\n`);

    // Activate all paused campaigns that are approved
    const result = await prisma.adCampaign.updateMany({
      where: {
        status: 'paused',
        approval_status: 'approved'
      },
      data: { status: 'active' },
    });

    console.log(`✅ Activated ${result.count} campaigns\n`);

    // Verify
    const newCounts = await prisma.adCampaign.groupBy({
      by: ['status'],
      _count: true,
    });

    console.log('Updated status distribution:');
    newCounts.forEach((group: any) => {
      console.log(`  ${group.status}: ${group._count}`);
    });

    // Show how many are now available
    const available = await prisma.adCampaign.count({
      where: {
        status: 'active',
        approval_status: 'approved',
        OR: [
          { end_date: null },
          { end_date: { gte: new Date() } }
        ]
      }
    });

    console.log(`\n🎉 Total ads now available for display: ${available}`);

    // Sample ads
    const samples = await prisma.adCampaign.findMany({
      where: {
        status: 'active',
        approval_status: 'approved'
      },
      select: { id: true, title: true },
      take: 5,
    });

    console.log('\nSample active campaigns:');
    samples.forEach((ad: any) => {
      console.log(`  - #${ad.id}: ${ad.title}`);
    });

    console.log('\n✅ Done! Your ads should now appear in the app.');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

activateAdCampaigns();
