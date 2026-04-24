import prisma from '../src/utils/prisma';

type DuplicateGroup = {
  voucher_id: number;
  used_by_id: number;
  cnt: bigint;
};

async function main() {
  const groups = await prisma.$queryRaw<DuplicateGroup[]>`
    SELECT voucher_id, used_by_id, COUNT(*)::bigint AS cnt
    FROM "VoucherRedemption"
    WHERE used_by_id IS NOT NULL
    GROUP BY voucher_id, used_by_id
    HAVING COUNT(*) > 1
    ORDER BY voucher_id ASC, used_by_id ASC
  `;

  let removed = 0;

  for (const g of groups) {
    const rows = await prisma.voucherRedemption.findMany({
      where: { voucher_id: g.voucher_id, used_by_id: g.used_by_id },
      select: { id: true, used_at: true },
      orderBy: [{ used_at: 'asc' }, { id: 'asc' }],
    });

    const toDelete = rows.slice(1).map((r) => r.id);
    if (toDelete.length > 0) {
      const result = await prisma.voucherRedemption.deleteMany({
        where: { id: { in: toDelete } },
      });
      removed += result.count;
    }
  }

  const [remaining] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM (
      SELECT voucher_id, used_by_id
      FROM "VoucherRedemption"
      WHERE used_by_id IS NOT NULL
      GROUP BY voucher_id, used_by_id
      HAVING COUNT(*) > 1
    ) t
  `;

  console.log('[REDEMPTION-DEDUPE] duplicate_groups_found:', groups.length);
  console.log('[REDEMPTION-DEDUPE] rows_removed:', removed);
  console.log('[REDEMPTION-DEDUPE] duplicate_groups_remaining:', Number(remaining?.count ?? 0n));
}

main()
  .catch((err) => {
    console.error('[REDEMPTION-DEDUPE] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
