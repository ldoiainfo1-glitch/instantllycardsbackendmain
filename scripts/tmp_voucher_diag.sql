SELECT COUNT(*) AS total_promotions,
       COUNT(*) FILTER (WHERE business_card_id IS NOT NULL) AS with_business_card_id,
       COUNT(DISTINCT business_card_id) FILTER (WHERE business_card_id IS NOT NULL) AS distinct_business_card_ids
FROM "BusinessPromotion";

SELECT COUNT(*) AS vouchers_with_business_id
FROM "Voucher"
WHERE business_id IS NOT NULL;

SELECT COUNT(*) AS vouchers_without_business_id
FROM "Voucher"
WHERE business_id IS NULL;
