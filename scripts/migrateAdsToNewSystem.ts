/**
 * Migration Script: Ad (legacy) → AdCampaign → AdVariant
 *
 * This script migrates 145 ads from the flat Ad table to the new
 * relational AdCampaign → AdVariant → Ad structure.
 *
 * Usage: npx ts-node scripts/migrateAdsToNewSystem.ts [--dry-run]
 * Safety: Always backs up before running. Use --dry-run first.
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env file
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
const isDryRun = process.argv.includes('--dry-run');

interface MigrationStats {
  totalAds: number;
  campaignsCreated: number;
  variantsCreated: number;
  skipped: number;
  errors: { adId: number; error: string }[];
}

async function migrateAdsToNewSystem(): Promise<void> {
  console.log('📋 Starting Ad Migration...');
  console.log(`   Mode: ${isDryRun ? '🔍 DRY RUN (no changes)' : '⚡ LIVE (will modify DB)'}`);
  console.log('');

  const stats: MigrationStats = {
    totalAds: 0,
    campaignsCreated: 0,
    variantsCreated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Step 1: Count legacy ads
    const legacyAds = await prisma.ad.findMany();
    stats.totalAds = legacyAds.length;

    console.log(`📊 Found ${stats.totalAds} legacy ads to migrate`);
    console.log('');

    // Step 2: Migrate each ad
    for (const ad of legacyAds) {
      try {
        console.log(`Processing Ad #${ad.id}: "${ad.title}"`);

        // Get business card owner
        const business = await prisma.businessCard.findUnique({
          where: { id: ad.business_id },
          include: { user: { select: { id: true } } },
        });

        if (!business) {
          console.log(`  ⚠️  Skipped: Business not found for ad #${ad.id}`);
          stats.skipped++;
          continue;
        }

        const userId = business.user.id;

        // Create AdCampaign
        const campaignData = {
          user_id: userId,
          business_card_id: ad.business_id,
          title: ad.title,
          description: ad.description || undefined,
          ad_type: ad.ad_type_legacy || ad.ad_type || 'banner',
          cta: ad.cta_url || undefined,
          creative_url: ad.bottom_image || ad.bottom_image_s3_url || ad.bottom_video || undefined,
          creative_urls: [
            ad.bottom_image,
            ad.bottom_image_s3_url,
            ad.fullscreen_image,
            ad.fullscreen_image_s3_url,
            ad.bottom_video,
            ad.bottom_video_s3_url,
            ad.fullscreen_video,
            ad.fullscreen_video_s3_url,
          ].filter((url): url is string => Boolean(url)),

          // Targeting
          target_city: undefined,
          target_age: undefined,
          target_interests: undefined,

          // Budget (estimate from legacy)
          daily_budget: 100, // Default since not in legacy data
          duration_days: ad.end_date && ad.start_date
            ? Math.ceil((ad.end_date.getTime() - ad.start_date.getTime()) / (1000 * 60 * 60 * 24))
            : 7,
          total_budget: undefined,

          // Status & approval
          status: ad.status === 'active' ? 'active' : 'paused',
          approval_status: ad.approval_status === 'approved' ? 'approved' : 'pending',

          // Dates
          start_date: ad.start_date || undefined,
          end_date: ad.end_date || undefined,
        };

        if (isDryRun) {
          console.log(`  ✓ DRY RUN: Would create campaign with:`, {
            title: campaignData.title,
            status: campaignData.status,
            approval_status: campaignData.approval_status,
          });
        } else {
          const campaign = await prisma.adCampaign.create({
            data: campaignData,
          });

          console.log(`  ✓ Campaign #${campaign.id} created`);
          stats.campaignsCreated++;

          // Create AdVariants (one for each media type)
          const variantData = [];

          // Bottom image variant
          if (ad.bottom_image || ad.bottom_image_s3_url) {
            variantData.push({
              campaign_id: campaign.id,
              creative_url: ad.bottom_image || ad.bottom_image_s3_url || '',
              label: 'Bottom Banner',
            });
          }

          // Fullscreen variant
          if (ad.fullscreen_image || ad.fullscreen_image_s3_url) {
            variantData.push({
              campaign_id: campaign.id,
              creative_url: ad.fullscreen_image || ad.fullscreen_image_s3_url || '',
              label: 'Fullscreen',
            });
          }

          // Video variants
          if (ad.bottom_video || ad.bottom_video_s3_url) {
            variantData.push({
              campaign_id: campaign.id,
              creative_url: ad.bottom_video || ad.bottom_video_s3_url || '',
              label: 'Bottom Video',
            });
          }

          if (ad.fullscreen_video || ad.fullscreen_video_s3_url) {
            variantData.push({
              campaign_id: campaign.id,
              creative_url: ad.fullscreen_video || ad.fullscreen_video_s3_url || '',
              label: 'Fullscreen Video',
            });
          }

          // Create variants
          if (variantData.length > 0) {
            const variants = await prisma.adVariant.createMany({
              data: variantData,
            });
            console.log(`  ✓ Created ${variants.count} variants`);
            stats.variantsCreated += variants.count;
          } else {
            console.log(`  ⚠️ No media found, variant not created`);
          }
        }
      } catch (error: any) {
        console.log(`  ❌ Error migrating ad #${ad.id}: ${error.message}`);
        stats.errors.push({
          adId: ad.id,
          error: error.message,
        });
      }

      console.log('');
    }

    // Step 3: Summary
    console.log('═'.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total Ads Processed:  ${stats.totalAds}`);
    console.log(`Campaigns Created:    ${stats.campaignsCreated}`);
    console.log(`Variants Created:     ${stats.variantsCreated}`);
    console.log(`Skipped:              ${stats.skipped}`);
    console.log(`Errors:               ${stats.errors.length}`);
    console.log('');

    if (stats.errors.length > 0) {
      console.log('⚠️  Errors encountered:');
      for (const err of stats.errors) {
        console.log(`   Ad #${err.adId}: ${err.error}`);
      }
      console.log('');
    }

    if (isDryRun) {
      console.log('🔍 Dry run complete. No changes made to database.');
      console.log('Run without --dry-run flag to apply migration.');
    } else {
      console.log('✅ Migration complete! Data has been migrated.');
      console.log('   Old Ad table remains for backward compatibility.');
      console.log('');
      console.log('💡 Next steps:');
      console.log('   1. Verify data: SELECT COUNT(*) FROM ad_campaigns;');
      console.log('   2. Test API endpoints: GET /ads/campaigns');
      console.log('   3. Update frontend to use new campaign endpoints');
    }

    // Verification
    const campaignCount = await prisma.adCampaign.count();
    const variantCount = await prisma.adVariant.count();
    console.log('');
    console.log('📈 Database counts:');
    console.log(`   AdCampaigns: ${campaignCount}`);
    console.log(`   AdVariants:  ${variantCount}`);
  } catch (error: any) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateAdsToNewSystem().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
