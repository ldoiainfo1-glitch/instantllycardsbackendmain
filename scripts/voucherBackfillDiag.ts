import prisma from '../src/utils/prisma';

async function main() {
  const [promoStats] = await prisma.$queryRaw<Array<{
    total_promotions: bigint;
    with_business_card_id: bigint;
    distinct_business_card_ids: bigint;
  }>>`
    SELECT COUNT(*) AS total_promotions,
           COUNT(*) FILTER (WHERE business_card_id IS NOT NULL) AS with_business_card_id,
           COUNT(DISTINCT business_card_id) FILTER (WHERE business_card_id IS NOT NULL) AS distinct_business_card_ids
    FROM "BusinessPromotion"
  `;

  const [voucherStats] = await prisma.$queryRaw<Array<{
    vouchers_with_business_id: bigint;
    vouchers_without_business_id: bigint;
  }>>`
    SELECT
      COUNT(*) FILTER (WHERE business_id IS NOT NULL) AS vouchers_with_business_id,
      COUNT(*) FILTER (WHERE business_id IS NULL) AS vouchers_without_business_id
    FROM "Voucher"
  `;

  const [joinStats] = await prisma.$queryRaw<Array<{ joinable_vouchers: bigint }>>`
    SELECT COUNT(*) AS joinable_vouchers
    FROM "Voucher" v
    JOIN "BusinessPromotion" bp ON bp.business_card_id = v.business_id
    WHERE v.business_promotion_id IS NULL
  `;

  console.log({
    promotions: {
      total: Number(promoStats?.total_promotions ?? 0n),
      withBusinessCardId: Number(promoStats?.with_business_card_id ?? 0n),
      distinctBusinessCardIds: Number(promoStats?.distinct_business_card_ids ?? 0n),
    },
    vouchers: {
      withBusinessId: Number(voucherStats?.vouchers_with_business_id ?? 0n),
      withoutBusinessId: Number(voucherStats?.vouchers_without_business_id ?? 0n),
    },
    joinableVouchers: Number(joinStats?.joinable_vouchers ?? 0n),
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
