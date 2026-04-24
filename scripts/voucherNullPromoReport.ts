import prisma from '../src/utils/prisma';

async function main() {
  const rows = await prisma.$queryRaw<Array<{
    vouchers: bigint;
    with_owner_user_id: bigint;
    with_original_owner_id: bigint;
    with_created_by_admin_id: bigint;
    with_transferred_from_id: bigint;
    with_business_id: bigint;
  }>>`
    SELECT
      COUNT(*)::bigint AS vouchers,
      COUNT(*) FILTER (WHERE owner_user_id IS NOT NULL)::bigint AS with_owner_user_id,
      COUNT(*) FILTER (WHERE original_owner_id IS NOT NULL)::bigint AS with_original_owner_id,
      COUNT(*) FILTER (WHERE created_by_admin_id IS NOT NULL)::bigint AS with_created_by_admin_id,
      COUNT(*) FILTER (WHERE transferred_from_id IS NOT NULL)::bigint AS with_transferred_from_id,
      COUNT(*) FILTER (WHERE business_id IS NOT NULL)::bigint AS with_business_id
    FROM "Voucher"
    WHERE business_promotion_id IS NULL
  `;

  const sample = await prisma.$queryRaw<Array<{
    id: number;
    business_id: number | null;
    business_name: string | null;
    owner_user_id: number | null;
    original_owner_id: number | null;
    created_by_admin_id: number | null;
    transferred_from_id: number | null;
  }>>`
    SELECT id, business_id, business_name, owner_user_id, original_owner_id, created_by_admin_id, transferred_from_id
    FROM "Voucher"
    WHERE business_promotion_id IS NULL
    ORDER BY id ASC
    LIMIT 20
  `;

  console.log('[NULL-PROMO-REPORT] summary:', {
    vouchers: Number(rows[0]?.vouchers ?? 0n),
    with_owner_user_id: Number(rows[0]?.with_owner_user_id ?? 0n),
    with_original_owner_id: Number(rows[0]?.with_original_owner_id ?? 0n),
    with_created_by_admin_id: Number(rows[0]?.with_created_by_admin_id ?? 0n),
    with_transferred_from_id: Number(rows[0]?.with_transferred_from_id ?? 0n),
    with_business_id: Number(rows[0]?.with_business_id ?? 0n),
  });
  console.log('[NULL-PROMO-REPORT] sample:', sample);
}

main()
  .catch((err) => {
    console.error('[NULL-PROMO-REPORT] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
