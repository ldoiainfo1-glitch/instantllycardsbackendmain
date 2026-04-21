-- Phase 3/4: strict enforcement and safety guards

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Voucher"
    WHERE "business_promotion_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL on Voucher.business_promotion_id: null rows still exist';
  END IF;
END $$;

ALTER TABLE "Voucher"
ALTER COLUMN "business_promotion_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "VoucherClaim_one_active_owner_idx"
  ON "VoucherClaim"("voucher_id")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "VoucherClaim_voucher_id_user_id_status_idx"
  ON "VoucherClaim"("voucher_id", "user_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VoucherRedemption_voucher_id_used_by_id_key'
  ) THEN
    ALTER TABLE "VoucherRedemption"
    ADD CONSTRAINT "VoucherRedemption_voucher_id_used_by_id_key"
    UNIQUE ("voucher_id", "used_by_id");
  END IF;
END $$;
