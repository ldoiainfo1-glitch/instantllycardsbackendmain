const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const r = await p.$queryRawUnsafe(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Voucher' AND column_name='instagram'"
    );
    console.log('Column check:', JSON.stringify(r));
    const sample = await p.voucher.findMany({
      select: { id: true, title: true, instagram: true },
      take: 5,
      orderBy: { id: 'desc' },
    });
    console.log('Latest 5 vouchers:', JSON.stringify(sample, null, 2));
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await p.$disconnect();
  }
})();
