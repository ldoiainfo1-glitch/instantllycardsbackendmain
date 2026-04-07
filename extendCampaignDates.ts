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

async function extendCampaigns() {
  try {
    console.log('📅 Extending expired campaign dates...\n');

    // Calculate new end date (30 days from now)
    const newEndDate = new Date();
    newEndDate.setDate(newEndDate.getDate() + 30);

    console.log(`Current time: ${new Date()}`);
    console.log(`Extending to: ${newEndDate}\n`);

    // Update all expired campaigns
    const result = await prisma.adCampaign.updateMany({
      where: {
        end_date: { lt: new Date() },
        approval_status: 'approved'
      },
      data: { end_date: newEndDate },
    });

    console.log(`✅ Extended ${result.count} expired campaigns\n`);

    // Verify counts
    const validNow = await prisma.adCampaign.count({
      where: {
        status: 'active',
        approval_status: 'approved',
        OR: [
          { end_date: null },
          { end_date: { gte: new Date() } }
        ]
      }
    });

    console.log(`🎉 Now available for display: ${validNow} campaigns\n`);

    // Sample
    const samples = await prisma.adCampaign.findMany({
      where: {
        status: 'active',
        approval_status: 'approved',
        end_date: { gte: new Date() }
      },
      select: { id: true, title: true, end_date: true },
      take: 5,
    });

    console.log('Sample campaigns now available:');
    samples.forEach((c: any) => {
      console.log(`  - #${c.id}: ${c.title}`);
    });

    console.log('\n✅ All campaigns should now display in the app!');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

extendCampaigns();
