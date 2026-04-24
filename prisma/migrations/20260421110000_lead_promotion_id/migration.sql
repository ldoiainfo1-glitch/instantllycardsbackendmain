-- Add business_promotion_id + relax business_id on Lead; add scope constraint + index.
ALTER TABLE "Lead" ALTER COLUMN "business_id" DROP NOT NULL;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "business_promotion_id" INTEGER;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_business_promotion_id_fkey"
  FOREIGN KEY ("business_promotion_id") REFERENCES "BusinessPromotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_scope_check"
  CHECK ("business_id" IS NOT NULL OR "business_promotion_id" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "Lead_business_promotion_id_idx" ON "Lead"("business_promotion_id");
