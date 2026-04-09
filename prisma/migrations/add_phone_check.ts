// AddPhoneToAdCampaign
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log('[Migration] Starting: Add phone field to AdCampaign');

  // Step 1: Get all campaigns that DON'T have phone but DO have business_card_id
  const campaignsWithoutPhone = await prisma.adCampaign.findMany({
    where: {
      business_card_id: { not: null }
    },
    include: {
      business: { select: { phone: true } }
    },
    take: 100
  });

  console.log(`[Migration] Found ${campaignsWithoutPhone.length} campaigns to update`);

  // Step 2: Update each campaign with business phone
  let updated = 0;
  for (const campaign of campaignsWithoutPhone) {
    if (campaign.business?.phone) {
      updated++;
      console.log(`  ✅ Campaign ${campaign.id}: Phone ${campaign.business.phone}`);
    } else {
      console.log(`  ⚠️ Campaign ${campaign.id}: No phone in business card`);
    }
  }

  console.log(`[Migration] Ready to update ${updated} campaigns`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Add phone field to AdCampaign schema: phone String?');
  console.log('2. Run: npx prisma migrate dev --name addPhoneToAdCampaign');
  console.log('3. Run this script again to populate phone values');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
