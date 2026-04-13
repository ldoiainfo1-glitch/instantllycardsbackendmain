-- AlterTable
ALTER TABLE "EventRegistration"
  ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN "payment_order_id" TEXT,
  ADD COLUMN "payment_id" TEXT,
  ADD COLUMN "payment_signature" TEXT,
  ADD COLUMN "amount_paid" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "EventRegistration_payment_id_idx" ON "EventRegistration"("payment_id");
