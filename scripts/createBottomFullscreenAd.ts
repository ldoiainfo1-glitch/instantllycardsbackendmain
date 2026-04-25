/**
 * Create a single ad campaign with bottom + fullscreen creatives.
 *
 * The mobile app expects creative_urls array to contain BOTH:
 *   - a URL ending with `/bottom`     (used by the carousel display)
 *   - a URL ending with `/fullscreen` (used by the full-screen modal)
 *
 * Usage (PowerShell):
 *   $env:AD_TITLE        = "Diwali Mega Sale"
 *   $env:AD_BOTTOM_URL   = "https://your-cdn.com/ads/diwali/bottom"
 *   $env:AD_FULLSCREEN_URL = "https://your-cdn.com/ads/diwali/fullscreen"
 *   $env:AD_USER_ID      = "1"                # owner user id (required)
 *   # Optional:
 *   $env:AD_TYPE         = "banner"           # banner | featured | inline (default: banner)
 *   $env:AD_DESCRIPTION  = "Up to 50% off on all products"
 *   $env:AD_CTA          = "https://yoursite.com/diwali"
 *   $env:AD_PHONE        = "+919999999999"
 *   $env:AD_CITY         = ""                 # leave blank for nationwide
 *   $env:AD_DAILY_BUDGET = "100"
 *   $env:AD_DURATION_DAYS = "30"
 *   $env:AD_BUSINESS_CARD_ID = ""             # optional, ad will appear on this card's promotions
 *   $env:AD_DRY_RUN      = "1"                # set to "1" to preview without inserting
 *
 *   npx ts-node scripts/createBottomFullscreenAd.ts
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set in .env');
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`${name} is required (set it as an env var or in .env)`);
  }
  return v.trim();
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

async function main() {
  const title = requireEnv('AD_TITLE');
  const bottomUrl = requireEnv('AD_BOTTOM_URL');
  const fullscreenUrl = requireEnv('AD_FULLSCREEN_URL');
  const userIdRaw = requireEnv('AD_USER_ID');

  const userId = parseInt(userIdRaw, 10);
  if (Number.isNaN(userId)) throw new Error('AD_USER_ID must be a valid integer');

  // Validate URL convention used by the mobile app
  if (!bottomUrl.includes('/bottom')) {
    throw new Error(
      `AD_BOTTOM_URL must contain "/bottom" (mobile app filters by this). Got: ${bottomUrl}`
    );
  }
  if (!fullscreenUrl.includes('/fullscreen')) {
    throw new Error(
      `AD_FULLSCREEN_URL must contain "/fullscreen" (mobile app filters by this). Got: ${fullscreenUrl}`
    );
  }

  const adType = optionalEnv('AD_TYPE') ?? 'banner';
  const description = optionalEnv('AD_DESCRIPTION') ?? null;
  const cta = optionalEnv('AD_CTA') ?? null;
  const phone = optionalEnv('AD_PHONE') ?? null;
  const targetCity = optionalEnv('AD_CITY') ?? null;
  const dailyBudget = parseFloat(optionalEnv('AD_DAILY_BUDGET') ?? '100');
  const durationDays = parseInt(optionalEnv('AD_DURATION_DAYS') ?? '30', 10);

  if (Number.isNaN(dailyBudget) || dailyBudget <= 0) {
    throw new Error('AD_DAILY_BUDGET must be a positive number');
  }
  if (Number.isNaN(durationDays) || durationDays <= 0) {
    throw new Error('AD_DURATION_DAYS must be a positive integer');
  }

  const businessCardIdRaw = optionalEnv('AD_BUSINESS_CARD_ID');
  let businessCardId: number | null = null;
  if (businessCardIdRaw) {
    const parsed = parseInt(businessCardIdRaw, 10);
    if (Number.isNaN(parsed)) throw new Error('AD_BUSINESS_CARD_ID must be a valid integer');
    businessCardId = parsed;
  }

  const dryRun = (optionalEnv('AD_DRY_RUN') ?? '0') === '1';

  // Verify the user exists (avoid silent FK violation)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true },
  });
  if (!user) {
    throw new Error(`User with id=${userId} does not exist in production DB`);
  }

  // If business_card_id given, verify it belongs to the same user
  if (businessCardId !== null) {
    const card = await prisma.businessCard.findUnique({
      where: { id: businessCardId },
      select: { id: true, user_id: true, company_name: true },
    });
    if (!card) {
      throw new Error(`BusinessCard with id=${businessCardId} does not exist`);
    }
    if (card.user_id !== userId) {
      console.warn(
        `⚠️  Warning: BusinessCard ${businessCardId} (${card.company_name}) belongs to user ${card.user_id}, not ${userId}. Continuing anyway.`
      );
    }
  }

  const totalBudget = dailyBudget * durationDays;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const data = {
    user_id: userId,
    business_card_id: businessCardId,
    title,
    description,
    ad_type: adType,
    cta,
    phone,
    creative_url: bottomUrl,                  // primary creative
    creative_urls: [bottomUrl, fullscreenUrl], // BOTH variants required by mobile
    target_city: targetCity,
    target_age: null,
    target_interests: null,
    daily_budget: dailyBudget,
    duration_days: durationDays,
    total_budget: totalBudget,
    status: 'active',
    approval_status: 'approved',              // admin-inserted, auto-approved
    start_date: startDate,
    end_date: endDate,
  };

  console.log('🎯 Ad campaign to be created:\n');
  console.log(JSON.stringify(data, null, 2));
  console.log(`\nOwner: ${user.name ?? '(no name)'}  phone=${user.phone}`);
  console.log(`Window: ${startDate.toISOString()} → ${endDate.toISOString()}`);

  if (dryRun) {
    console.log('\n🔎 DRY RUN — nothing was inserted. Unset AD_DRY_RUN to actually create.');
    return;
  }

  const created = await prisma.adCampaign.create({
    data,
    include: { variants: true },
  });

  console.log(`\n✅ Created AdCampaign id=${created.id}`);
  console.log(`   status=${created.status}  approval=${created.approval_status}`);
  console.log(`   creative_urls=${JSON.stringify(created.creative_urls)}`);
  console.log(`\n📱 The mobile app should now show this ad on next refresh of the carousel.`);
}

main()
  .catch((err) => {
    console.error('❌ Failed:', err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
