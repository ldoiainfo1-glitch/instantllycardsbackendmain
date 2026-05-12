-- Add city and pincode columns to Voucher
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "pincode" TEXT;
