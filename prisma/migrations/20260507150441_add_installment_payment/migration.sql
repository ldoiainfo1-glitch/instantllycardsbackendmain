-- Add installment payment fields to Voucher
ALTER TABLE "Voucher" ADD COLUMN "allows_installment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Voucher" ADD COLUMN "upfront_amount" DECIMAL(10,2);

-- Add installment fields to VoucherClaim
ALTER TABLE "VoucherClaim" ADD COLUMN "remaining_balance" DECIMAL(10,2);
ALTER TABLE "VoucherClaim" ADD COLUMN "paid_amount" DECIMAL(10,2);
ALTER TABLE "VoucherClaim" ADD COLUMN "installment_deadline" TIMESTAMP(3);
ALTER TABLE "VoucherClaim" ADD COLUMN "installment_status" TEXT;
CREATE INDEX "VoucherClaim_installment_status_installment_deadline_idx" ON "VoucherClaim"("installment_status", "installment_deadline");

-- Create InstallmentPayment table
CREATE TABLE "InstallmentPayment" (
    "id" SERIAL NOT NULL,
    "claim_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "razorpay_order_id" TEXT NOT NULL,
    "razorpay_payment_id" TEXT NOT NULL,
    CONSTRAINT "InstallmentPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallmentPayment_claim_id_idx" ON "InstallmentPayment"("claim_id");

ALTER TABLE "InstallmentPayment" ADD CONSTRAINT "InstallmentPayment_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "VoucherClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
