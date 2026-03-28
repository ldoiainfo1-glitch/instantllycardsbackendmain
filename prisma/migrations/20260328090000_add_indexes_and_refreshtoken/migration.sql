-- Manual migration: add RefreshToken table + performance indexes (no data loss)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'RefreshToken'
  ) THEN
    CREATE TABLE "RefreshToken" (
      "id" SERIAL PRIMARY KEY,
      "user_id" INTEGER NOT NULL,
      "token_hash" TEXT NOT NULL,
      "expires_at" TIMESTAMP(3) NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE "RefreshToken"
      ADD CONSTRAINT "RefreshToken_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- BusinessCard indexes
CREATE INDEX IF NOT EXISTS "BusinessCard_user_id_idx" ON "BusinessCard"("user_id");
CREATE INDEX IF NOT EXISTS "BusinessCard_created_at_idx" ON "BusinessCard"("created_at");
CREATE INDEX IF NOT EXISTS "BusinessCard_category_idx" ON "BusinessCard"("category");
CREATE INDEX IF NOT EXISTS "BusinessCard_company_name_idx" ON "BusinessCard"("company_name");
CREATE INDEX IF NOT EXISTS "BusinessCard_full_name_idx" ON "BusinessCard"("full_name");

-- Review indexes
CREATE INDEX IF NOT EXISTS "Review_business_id_idx" ON "Review"("business_id");
CREATE INDEX IF NOT EXISTS "Review_user_id_idx" ON "Review"("user_id");
CREATE INDEX IF NOT EXISTS "Review_created_at_idx" ON "Review"("created_at");

-- Voucher indexes
CREATE INDEX IF NOT EXISTS "Voucher_business_id_idx" ON "Voucher"("business_id");
CREATE INDEX IF NOT EXISTS "Voucher_status_idx" ON "Voucher"("status");
CREATE INDEX IF NOT EXISTS "Voucher_expires_at_idx" ON "Voucher"("expires_at");

-- BusinessPromotion indexes
CREATE INDEX IF NOT EXISTS "BusinessPromotion_user_id_idx" ON "BusinessPromotion"("user_id");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_business_card_id_idx" ON "BusinessPromotion"("business_card_id");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_listing_type_idx" ON "BusinessPromotion"("listing_type");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_status_idx" ON "BusinessPromotion"("status");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_is_active_idx" ON "BusinessPromotion"("is_active");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_created_at_idx" ON "BusinessPromotion"("created_at");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_city_idx" ON "BusinessPromotion"("city");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_state_idx" ON "BusinessPromotion"("state");
CREATE INDEX IF NOT EXISTS "BusinessPromotion_category_idx" ON "BusinessPromotion" USING GIN ("category");
