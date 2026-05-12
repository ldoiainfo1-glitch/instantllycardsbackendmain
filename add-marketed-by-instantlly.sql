-- Add marketed_by_instantlly flag for vouchers promoted under the Instantlly brand
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "marketed_by_instantlly" BOOLEAN NOT NULL DEFAULT false;
