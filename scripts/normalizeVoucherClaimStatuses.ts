import prisma from '../src/utils/prisma';

type DuplicateActiveGroup = {
  voucher_id: number;
  cnt: bigint;
};

type ActiveClaim = {
  id: number;
  voucher_id: number;
  redeemed_at: Date | null;
  claimed_at: Date;
};

async function main() {
  const duplicateGroups = await prisma.$queryRaw<DuplicateActiveGroup[]>`
    SELECT voucher_id, COUNT(*)::bigint AS cnt
    FROM "VoucherClaim"
    WHERE status = 'active'
    GROUP BY voucher_id
    HAVING COUNT(*) > 1
    ORDER BY voucher_id ASC
  `;

  let groupsFixed = 0;
  let claimsDowngraded = 0;

  for (const group of duplicateGroups) {
    const claims = await prisma.voucherClaim.findMany({
      where: { voucher_id: group.voucher_id, status: 'active' },
      select: { id: true, voucher_id: true, redeemed_at: true, claimed_at: true },
      orderBy: [{ claimed_at: 'desc' }, { id: 'desc' }],
    }) as ActiveClaim[];

    if (claims.length <= 1) continue;

    const keep = claims[0];
    const toDowngrade = claims.slice(1);

    for (const claim of toDowngrade) {
      const nextStatus = claim.redeemed_at ? 'redeemed' : 'transferred';
      await prisma.voucherClaim.update({
        where: { id: claim.id },
        data: { status: nextStatus },
      });
      claimsDowngraded += 1;
    }

    if (keep.redeemed_at) {
      await prisma.voucherClaim.update({
        where: { id: keep.id },
        data: { status: 'redeemed' },
      });
    }

    groupsFixed += 1;
  }

  const [remaining] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM (
      SELECT voucher_id
      FROM "VoucherClaim"
      WHERE status = 'active'
      GROUP BY voucher_id
      HAVING COUNT(*) > 1
    ) t
  `;

  console.log('[CLAIM-NORMALIZE] duplicate_groups_found:', duplicateGroups.length);
  console.log('[CLAIM-NORMALIZE] groups_fixed:', groupsFixed);
  console.log('[CLAIM-NORMALIZE] claims_downgraded:', claimsDowngraded);
  console.log('[CLAIM-NORMALIZE] duplicate_groups_remaining:', Number(remaining?.count ?? 0n));
}

main()
  .catch((err) => {
    console.error('[CLAIM-NORMALIZE] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
