import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAds() {
  // Check approval status distribution
  const statusCounts = await prisma.adCampaign.groupBy({
    by: ['approval_status'],
    _count: true,
  });

  console.log('Status distribution:');
  statusCounts.forEach(group => {
    console.log(`  ${group.approval_status}: ${group._count}`);
  });

  // Check active & approved ads
  const approved = await prisma.adCampaign.findMany({
    where: {
      status: 'active',
      approval_status: 'approved',
    },
    select: { id: true, title: true, approval_status: true },
  });

  console.log(`\nApproved & Active: ${approved.length}`);
  if (approved.length > 0) {
    approved.slice(0, 5).forEach(ad => {
      console.log(`  - Campaign #${ad.id}: ${ad.title}`);
    });
  }
}

checkAds().finally(() => prisma.$disconnect());
