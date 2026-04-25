/**
 * One-shot script: update AdCampaign 151 (WEALTHY AND LIFE) with correct image URLs.
 * Run: npx ts-node --transpile-only updateWealthyLifeAd.ts
 */
import "dotenv/config";
import prisma from "./src/prismaClient";

const API_BASE = process.env.API_BASE_URL || "https://api.instantllycards.com";

const BANNER_URL = `${API_BASE}/ads/wealthy-life-banner.jpg`;
const FULLSCREEN_URL = `${API_BASE}/ads/wealthy-life-fullscreen.jpg`;

async function main() {
  const campaign = await prisma.adCampaign.findUnique({ where: { id: 151 } });
  if (!campaign) {
    console.error("Campaign 151 not found");
    process.exit(1);
  }
  console.log("Current creative_url:", campaign.creative_url);
  console.log("Current creative_urls:", campaign.creative_urls);

  const updated = await prisma.adCampaign.update({
    where: { id: 151 },
    data: {
      creative_url: BANNER_URL,
      creative_urls: [BANNER_URL, FULLSCREEN_URL],
    },
  });

  console.log("\n✅ Updated campaign 151:");
  console.log("  creative_url   :", updated.creative_url);
  console.log("  creative_urls  :", updated.creative_urls);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
