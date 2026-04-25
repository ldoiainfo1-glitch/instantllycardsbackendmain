-- Add nullable column first so existing rows can be backfilled
ALTER TABLE "Event" ADD COLUMN "business_promotion_id" INTEGER;

-- Backfill: pick the latest active BusinessPromotion for the event's business card
UPDATE "Event" e
SET "business_promotion_id" = (
  SELECT p."id"
  FROM "BusinessPromotion" p
  WHERE p."business_card_id" = e."business_id"
  ORDER BY
    CASE WHEN p."status" = 'active' THEN 0 ELSE 1 END,
    p."created_at" DESC
  LIMIT 1
)
WHERE e."business_promotion_id" IS NULL;

-- Any remaining rows (business card had no promotion): attach to the card owner's newest promotion
UPDATE "Event" e
SET "business_promotion_id" = (
  SELECT p."id"
  FROM "BusinessPromotion" p
  INNER JOIN "BusinessCard" c ON c."user_id" = p."user_id"
  WHERE c."id" = e."business_id"
  ORDER BY p."created_at" DESC
  LIMIT 1
)
WHERE e."business_promotion_id" IS NULL;

-- Drop any events that still have no promotion (orphaned, cannot be scoped)
DELETE FROM "Event" WHERE "business_promotion_id" IS NULL;

-- Enforce NOT NULL on business_promotion_id, allow NULL on business_id
ALTER TABLE "Event" ALTER COLUMN "business_promotion_id" SET NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "business_id" DROP NOT NULL;

-- Replace existing FK on business_id with SET NULL instead of CASCADE
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_business_id_fkey";
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- New FK to BusinessPromotion
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_business_promotion_id_fkey"
  FOREIGN KEY ("business_promotion_id") REFERENCES "BusinessPromotion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Event_business_promotion_id_idx" ON "Event"("business_promotion_id");
CREATE INDEX "Event_business_promotion_id_status_idx" ON "Event"("business_promotion_id", "status");
