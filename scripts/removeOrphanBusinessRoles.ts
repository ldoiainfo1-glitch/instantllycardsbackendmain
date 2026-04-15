import prisma from '../src/utils/prisma';

async function main() {
  // Find all users with 'business' role
  const bizRoles = await prisma.userRole.findMany({
    where: { role: 'business' },
    select: { user_id: true },
  });
  const ids = bizRoles.map((r) => r.user_id);

  // Find which of those have at least one promotion
  const promos = await prisma.businessPromotion.findMany({
    where: { user_id: { in: ids } },
    select: { user_id: true },
    distinct: ['user_id'],
  });
  const hasPromo = new Set(promos.map((p) => p.user_id));

  // Users with business role but NO promotion
  const noPromo = ids.filter((id) => !hasPromo.has(id));

  console.log(`Business role users: ${ids.length}`);
  console.log(`With promotion: ${hasPromo.size}`);
  console.log(`WITHOUT promotion (to remove): ${noPromo.length}`);

  if (noPromo.length === 0) {
    console.log('Nothing to clean up.');
    await prisma.$disconnect();
    return;
  }

  // Remove business role from users without any promotion
  const deleted = await prisma.userRole.deleteMany({
    where: {
      user_id: { in: noPromo },
      role: 'business',
    },
  });

  console.log(`Removed business role from ${deleted.count} users.`);
  console.log('User IDs cleaned:', noPromo);

  await prisma.$disconnect();
}

main();
