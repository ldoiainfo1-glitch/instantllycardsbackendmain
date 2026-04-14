import prisma from '../src/utils/prisma';

async function main() {
  const phones = ['8180964068', '9373193179'];
  const users = await prisma.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true, phone: true },
  });
  console.log('Found users:', users);

  for (const u of users) {
    await prisma.userRole.upsert({
      where: { user_id_role: { user_id: u.id, role: 'customer' } },
      update: {},
      create: { user_id: u.id, role: 'customer' },
    });
    console.log(`Added customer role for phone=${u.phone} userId=${u.id}`);
  }

  // Verify
  const allRoles = await prisma.userRole.findMany({
    where: { user_id: { in: users.map((u) => u.id) } },
  });
  console.log('All roles now:', allRoles);
  await prisma.$disconnect();
}

main();
