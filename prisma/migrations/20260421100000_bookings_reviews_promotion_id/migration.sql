-- Make Booking and Review promotion-first.
-- Adds optional business_promotion_id columns and allows business_id to be null
-- so promotion listings without a linked business card can still have bookings/reviews.

-- Booking ---------------------------------------------------------------
ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "business_promotion_id" INTEGER,
  ALTER COLUMN "business_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Booking_business_promotion_id_fkey'
  ) THEN
    ALTER TABLE "Booking"
      ADD CONSTRAINT "Booking_business_promotion_id_fkey"
      FOREIGN KEY ("business_promotion_id") REFERENCES "BusinessPromotion"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Booking_scope_chk'
  ) THEN
    ALTER TABLE "Booking"
      ADD CONSTRAINT "Booking_scope_chk"
      CHECK ("business_id" IS NOT NULL OR "business_promotion_id" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Booking_business_promotion_id_idx"
  ON "Booking"("business_promotion_id")
  WHERE "business_promotion_id" IS NOT NULL;

-- Review ----------------------------------------------------------------
ALTER TABLE "Review"
  ADD COLUMN IF NOT EXISTS "business_promotion_id" INTEGER,
  ALTER COLUMN "business_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Review_business_promotion_id_fkey'
  ) THEN
    ALTER TABLE "Review"
      ADD CONSTRAINT "Review_business_promotion_id_fkey"
      FOREIGN KEY ("business_promotion_id") REFERENCES "BusinessPromotion"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Review_scope_chk'
  ) THEN
    ALTER TABLE "Review"
      ADD CONSTRAINT "Review_scope_chk"
      CHECK ("business_id" IS NOT NULL OR "business_promotion_id" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Review_business_promotion_id_idx"
  ON "Review"("business_promotion_id")
  WHERE "business_promotion_id" IS NOT NULL;
