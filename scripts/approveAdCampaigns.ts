/**
 * Approve migrated ad campaigns for public display
 *
 * All 145 migrated campaigns should be approved so they appear in the app
 * Usage: npx ts-node scripts/approveAdCampaigns.ts
 */

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

async function approveAdCampaigns() {
  try {
    console.log('📊 Checking ad campaign approval status...\n');

    // Check current status distribution
    const statusCounts = await prisma.adCampaign.groupBy({
      by: ['approval_status'],
      _count: true,
    });

    console.log('Current status distribution:');
    statusCounts.forEach(group => {
      console.log(`  ${group.approval_status}: ${group._count}`);
    });

    // Count pending campaigns
    const pendingCount = await prisma.adCampaign.count({
      where: { approval_status: 'pending' },
    });

    if (pendingCount === 0) {
      console.log('\n✅ All campaigns already approved!');
      return;
    }

    console.log(`\n⏳ Approving ${pendingCount} pending campaigns...\n`);

    // Approve all pending campaigns
    const result = await prisma.adCampaign.updateMany({
      where: { approval_status: 'pending' },
      data: { approval_status: 'approved' },
    });

    console.log(`✅ Approved ${result.count} campaigns\n`);

    // Verify
    const newCounts = await prisma.adCampaign.groupBy({
      by: ['approval_status'],
      _count: true,
    });

    console.log('Updated status distribution:');
    newCounts.forEach(group => {
      console.log(`  ${group.approval_status}: ${group._count}`);
    });

    // Show sample approved ads
    const samples = await prisma.adCampaign.findMany({
      where: { approval_status: 'approved', status: 'active' },
      select: { id: true, title: true, ad_type: true },
      take: 5,
    });

    console.log('\nSample approved active campaigns:');
    samples.forEach(ad => {
      console.log(`  - #${ad.id} (${ad.ad_type}): ${ad.title}`);
    });

    console.log('\n🎉 Done! Your ads should now appear in the app.');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

approveAdCampaigns();
