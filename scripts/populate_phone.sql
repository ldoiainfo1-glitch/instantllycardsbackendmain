-- PostgreSQL Script: Populate phone field in ad_campaigns from related BusinessCard
-- Run this after migration to add_phone_to_ad_campaign

-- Show before state
SELECT 'BEFORE' as status, COUNT(*) total,
       COUNT(CASE WHEN phone IS NULL THEN 1 END) without_phone,
       COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) with_phone
FROM ad_campaigns;

-- Update phone from BusinessCard.phone where campaign has business_card_id
UPDATE ad_campaigns ac
SET phone = bc.phone
FROM "BusinessCard" bc
WHERE ac.business_card_id = bc.id
  AND ac.phone IS NULL
  AND bc.phone IS NOT NULL;

-- Show after status
SELECT 'AFTER' as status, COUNT(*) total,
       COUNT(CASE WHEN phone IS NULL THEN 1 END) without_phone,
       COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) with_phone
FROM ad_campaigns;

-- Show specific campaigns with phone
SELECT
  ac.id,
  ac.title,
  ac.business_card_id,
  ac.phone,
  bc.phone as business_phone,
  ac.status
FROM ad_campaigns ac
LEFT JOIN "BusinessCard" bc ON ac.business_card_id = bc.id
WHERE ac.phone IS NOT NULL
ORDER BY ac.id DESC
LIMIT 20;
