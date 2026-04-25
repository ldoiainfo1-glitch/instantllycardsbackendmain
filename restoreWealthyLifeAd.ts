/**
 * Restore campaign 151 to original CloudFront URLs.
 * The normalizeCreativeUrl bug in production corrupts any URL with /ads/ in it.
 * Fix: store the images at a URL path the old normalizer won't touch,
 * by using the /api/ads/image/ prefix (which the normalizer recognises as already fixed).
 *
 * Run: npx ts-node --transpile-only restoreWealthyLifeAd.ts
 */
import "dotenv/config";
import prisma from "./src/prismaClient";

const API_BASE = process.env.API_BASE_URL || "https://api.instantllycards.com";

// These paths already contain /api/ads so the old normalizer won't touch them.
// The backend static middleware serves /api/ads/* from public/ads/
const BANNER_URL = `${API_BASE}/api/ads/wealthy-life-banner.jpg`;
const FULLSCREEN_URL = `${API_BASE}/api/ads/wealthy-life-fullscreen.jpg`;

async function main() {
  const updated = await prisma.adCampaign.update({
    where: { id: 151 },
    data: {
      creative_url: BANNER_URL,
      creative_urls: [BANNER_URL, FULLSCREEN_URL],
    },
  });

  console.log("✅ Updated campaign 151:");
  console.log("  creative_url  :", updated.creative_url);
  console.log("  creative_urls :", updated.creative_urls);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
