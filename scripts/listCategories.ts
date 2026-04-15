import prisma from '../src/utils/prisma';

async function main() {
  const cats = await prisma.category.findMany({
    where: { is_active: true },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
  console.log('Available categories:');
  cats.forEach((c) => console.log(`  - ${c.name}`));
  await prisma.$disconnect();
}

main();
