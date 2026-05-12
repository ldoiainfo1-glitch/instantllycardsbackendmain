-- Add quantity to VoucherClaim so users can purchase multiple units in one claim.
ALTER TABLE "VoucherClaim" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1;

-- Add quantity and is_owner_transfer to VoucherTransfer to support owner gifting vouchers directly.
ALTER TABLE "VoucherTransfer" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "VoucherTransfer" ADD COLUMN IF NOT EXISTS "is_owner_transfer" BOOLEAN NOT NULL DEFAULT false;
