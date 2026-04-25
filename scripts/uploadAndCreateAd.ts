/**
 * Upload bottom + fullscreen ad images to S3, then create an AdCampaign in production.
 *
 * Folder layout (you provide the images here):
 *   scripts/ad-assets/bottom.jpg
 *   scripts/ad-assets/fullscreen.jpg
 * (.png / .webp / .jpeg also accepted; auto-detected)
 *
 * The script uploads to S3 keys like:
 *   ads/{slug}-{timestamp}/bottom.jpg
 *   ads/{slug}-{timestamp}/fullscreen.jpg
 *
 * Resulting public URLs contain "/bottom" and "/fullscreen" substrings so the
 * mobile carousel filter (creative_urls.find(u => u.includes('/bottom'))) works.
 *
 * Usage (PowerShell):
 *   cd d:\Instantlly\Instantlly-Main-Project\instantllycardsbackendmain
 *
 *   # Required:
 *   $env:AD_TITLE   = "Diwali Mega Sale"
 *   $env:AD_USER_ID = "1"                    # owner of the ad in DB
 *
 *   # Optional (highly recommended):
 *   $env:AD_PHONE        = "+919999999999"   # BUSINESS owner's contact number
 *   $env:AD_DESCRIPTION  = "Up to 50% off on all products"
 *   $env:AD_CTA          = "https://yoursite.com/diwali"
 *   $env:AD_TYPE         = "banner"          # banner | featured | inline
 *   $env:AD_CITY         = ""                # blank = nationwide
 *   $env:AD_DAILY_BUDGET = "100"
 *   $env:AD_DURATION_DAYS = "30"
 *   $env:AD_BUSINESS_CARD_ID = ""            # optional, link ad to a card
 *   $env:AD_ASSETS_DIR   = ""                # default: scripts/ad-assets
 *   $env:AD_SLUG         = ""                # default: derived from AD_TITLE
 *   $env:AD_DRY_RUN      = "1"               # preview without uploading/inserting
 *
 *   npx ts-node scripts/uploadAndCreateAd.ts
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

// ----- DB setup (PrismaPg + pg.Pool, SSL for Supabase) -----
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set in .env');

const needsSsl =
  /supabase\.com|pooler\.supabase\.com/i.test(databaseUrl) ||
  /sslmode=require/i.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 1,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ----- S3 setup -----
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const S3_BUCKET = process.env.S3_BUCKET;
const CLOUDFRONT_HOST = process.env.CLOUDFRONT_HOST;

if (!S3_BUCKET) throw new Error('S3_BUCKET is not set in .env');
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set in .env');
}

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ----- Helpers -----
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`${name} is required (set as env var or in .env)`);
  }
  return v.trim();
}
function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function findAssetFile(dir: string, baseName: 'bottom' | 'fullscreen'): string {
  for (const ext of ALLOWED_EXTS) {
    const candidate = path.join(dir, `${baseName}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${baseName}.{${ALLOWED_EXTS.join('|')}} in ${dir}.\n` +
      `Drop the image at ${path.join(dir, baseName)}.jpg (or .png / .webp) and retry.`
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'ad';
}

function buildPublicUrl(key: string): string {
  if (CLOUDFRONT_HOST) return `https://${CLOUDFRONT_HOST}/${key}`;
  return `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

async function uploadFile(localPath: string, s3Key: string): Promise<string> {
  const ext = path.extname(localPath).slice(1).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const body = fs.readFileSync(localPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET!,
      Key: s3Key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return buildPublicUrl(s3Key);
}

// ----- Main -----
async function main() {
  const title = requireEnv('AD_TITLE');
  const userIdRaw = requireEnv('AD_USER_ID');
  const userId = parseInt(userIdRaw, 10);
  if (Number.isNaN(userId)) throw new Error('AD_USER_ID must be a valid integer');

  const adType = optionalEnv('AD_TYPE') ?? 'banner';
  const description = optionalEnv('AD_DESCRIPTION') ?? null;
  const cta = optionalEnv('AD_CTA') ?? null;
  const phone = optionalEnv('AD_PHONE') ?? null; // business owner's contact number
  const targetCity = optionalEnv('AD_CITY') ?? null;
  const dailyBudget = parseFloat(optionalEnv('AD_DAILY_BUDGET') ?? '100');
  const durationDays = parseInt(optionalEnv('AD_DURATION_DAYS') ?? '30', 10);

  if (Number.isNaN(dailyBudget) || dailyBudget <= 0)
    throw new Error('AD_DAILY_BUDGET must be a positive number');
  if (Number.isNaN(durationDays) || durationDays <= 0)
    throw new Error('AD_DURATION_DAYS must be a positive integer');

  const businessCardIdRaw = optionalEnv('AD_BUSINESS_CARD_ID');
  let businessCardId: number | null = null;
  if (businessCardIdRaw) {
    const parsed = parseInt(businessCardIdRaw, 10);
    if (Number.isNaN(parsed)) throw new Error('AD_BUSINESS_CARD_ID must be a valid integer');
    businessCardId = parsed;
  }

  const dryRun = (optionalEnv('AD_DRY_RUN') ?? '0') === '1';
  const assetsDir =
    optionalEnv('AD_ASSETS_DIR') ?? path.join(__dirname, 'ad-assets');

  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Assets directory not found: ${assetsDir}`);
  }

  // Find local files
  const bottomLocal = findAssetFile(assetsDir, 'bottom');
  const fullscreenLocal = findAssetFile(assetsDir, 'fullscreen');

  // Build S3 keys; preserving "bottom" / "fullscreen" in the path is REQUIRED so
  // the mobile filter (url.includes('/bottom') / '/fullscreen') matches.
  const slug = optionalEnv('AD_SLUG') ?? slugify(title);
  const stamp = Date.now();
  const folder = `ads/${slug}-${stamp}`;
  const bottomExt = path.extname(bottomLocal).slice(1).toLowerCase();
  const fullscreenExt = path.extname(fullscreenLocal).slice(1).toLowerCase();
  const bottomKey = `${folder}/bottom.${bottomExt}`;
  const fullscreenKey = `${folder}/fullscreen.${fullscreenExt}`;

  // Verify owner exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true },
  });
  if (!user) throw new Error(`User with id=${userId} does not exist in production DB`);

  if (businessCardId !== null) {
    const card = await prisma.businessCard.findUnique({
      where: { id: businessCardId },
      select: { id: true, user_id: true, company_name: true },
    });
    if (!card) throw new Error(`BusinessCard with id=${businessCardId} does not exist`);
    if (card.user_id !== userId) {
      console.warn(
        `⚠️  Warning: BusinessCard ${businessCardId} (${card.company_name}) belongs to user ${card.user_id}, not ${userId}. Continuing.`
      );
    }
  }

  // Compute final URLs (without uploading yet, for preview)
  const bottomUrl = buildPublicUrl(bottomKey);
  const fullscreenUrl = buildPublicUrl(fullscreenKey);

  // Sanity: URLs must contain /bottom and /fullscreen for the mobile filter
  if (!bottomUrl.includes('/bottom')) throw new Error(`Internal: bottom URL missing /bottom: ${bottomUrl}`);
  if (!fullscreenUrl.includes('/fullscreen'))
    throw new Error(`Internal: fullscreen URL missing /fullscreen: ${fullscreenUrl}`);

  const totalBudget = dailyBudget * durationDays;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  console.log('🎯 Ad campaign preview:\n');
  console.log({
    title,
    description,
    ad_type: adType,
    cta,
    phone,
    target_city: targetCity,
    daily_budget: dailyBudget,
    duration_days: durationDays,
    total_budget: totalBudget,
    user_id: userId,
    business_card_id: businessCardId,
  });
  console.log('\n📁 Local files:');
  console.log(`  bottom    : ${bottomLocal}  (${(fs.statSync(bottomLocal).size / 1024).toFixed(1)} KB)`);
  console.log(`  fullscreen: ${fullscreenLocal}  (${(fs.statSync(fullscreenLocal).size / 1024).toFixed(1)} KB)`);
  console.log('\n☁️  Will upload to S3:');
  console.log(`  bucket=${S3_BUCKET}  region=${AWS_REGION}`);
  console.log(`  ${bottomKey}      → ${bottomUrl}`);
  console.log(`  ${fullscreenKey}  → ${fullscreenUrl}`);
  console.log(`\nOwner: ${user.name ?? '(no name)'}  user_id=${user.id}  user_phone=${user.phone}`);
  console.log(`Window: ${startDate.toISOString()} → ${endDate.toISOString()}`);

  if (dryRun) {
    console.log('\n🔎 DRY RUN — nothing was uploaded or inserted.');
    console.log('   Set $env:AD_DRY_RUN = "0" (or remove it) to actually run.');
    return;
  }

  // Verify bucket reachable before doing work
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET! }));
  } catch (err: any) {
    throw new Error(
      `Cannot access S3 bucket "${S3_BUCKET}" in region "${AWS_REGION}": ${err.message ?? err}`
    );
  }

  // Upload both images
  console.log('\n⬆️  Uploading bottom image…');
  const uploadedBottomUrl = await uploadFile(bottomLocal, bottomKey);
  console.log(`   ✓ ${uploadedBottomUrl}`);

  console.log('⬆️  Uploading fullscreen image…');
  const uploadedFullscreenUrl = await uploadFile(fullscreenLocal, fullscreenKey);
  console.log(`   ✓ ${uploadedFullscreenUrl}`);

  // Create the AdCampaign
  console.log('\n💾 Creating AdCampaign in DB…');
  const created = await prisma.adCampaign.create({
    data: {
      user_id: userId,
      business_card_id: businessCardId,
      title,
      description,
      ad_type: adType,
      cta,
      phone, // business owner's contact number (free text — NOT a user FK)
      creative_url: uploadedBottomUrl,
      creative_urls: [uploadedBottomUrl, uploadedFullscreenUrl],
      target_city: targetCity,
      target_age: null,
      target_interests: null,
      daily_budget: dailyBudget,
      duration_days: durationDays,
      total_budget: totalBudget,
      status: 'active',
      approval_status: 'approved', // admin-inserted, auto-approved
      start_date: startDate,
      end_date: endDate,
    },
  });

  console.log('\n✅ AdCampaign created:');
  console.log(`   id=${created.id}`);
  console.log(`   status=${created.status}  approval=${created.approval_status}`);
  console.log(`   start=${created.start_date.toISOString()}`);
  console.log(`   end=${created.end_date?.toISOString()}`);
  console.log(`   creative_url=${created.creative_url}`);
  console.log(`   creative_urls=${JSON.stringify(created.creative_urls)}`);
  console.log('\n📱 Mobile app will pick this up on next /ads/campaigns refresh.');
}

main()
  .catch((err) => {
    console.error('\n❌ Failed:', err?.message ?? err);
    if (err?.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
