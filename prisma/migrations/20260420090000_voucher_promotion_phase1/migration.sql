-- Phase 1: additive voucher promotion migration (safe, idempotent)

ALTER TABLE "Voucher"
ADD COLUMN IF NOT EXISTS "business_promotion_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Voucher_business_promotion_id_fkey'
  ) THEN
    ALTER TABLE "Voucher"
    ADD CONSTRAINT "Voucher_business_promotion_id_fkey"
    FOREIGN KEY ("business_promotion_id")
    REFERENCES "BusinessPromotion"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Voucher_business_promotion_id_idx"
  ON "Voucher"("business_promotion_id");

CREATE INDEX IF NOT EXISTS "Voucher_business_promotion_id_status_idx"
  ON "Voucher"("business_promotion_id", "status");

ALTER TABLE "VoucherClaim"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "VoucherClaim_voucher_id_status_idx"
  ON "VoucherClaim"("voucher_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VoucherClaim_user_id_voucher_id_key'
  ) THEN
    ALTER TABLE "VoucherClaim"
    ADD CONSTRAINT "VoucherClaim_user_id_voucher_id_key"
    UNIQUE ("user_id", "voucher_id");
  END IF;
END $$;
