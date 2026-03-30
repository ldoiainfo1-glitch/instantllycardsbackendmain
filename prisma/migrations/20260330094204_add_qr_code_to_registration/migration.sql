-- DropIndex
DROP INDEX "Review_business_id_idx";

-- DropIndex
DROP INDEX "Review_created_at_idx";

-- DropIndex
DROP INDEX "Review_user_id_idx";

-- AlterTable
ALTER TABLE "EventRegistration" ADD COLUMN     "qr_code" TEXT;

-- CreateIndex
CREATE INDEX "Booking_business_id_idx" ON "Booking"("business_id");

-- CreateIndex
CREATE INDEX "Booking_user_id_idx" ON "Booking"("user_id");

-- CreateIndex
CREATE INDEX "Booking_created_at_idx" ON "Booking"("created_at");
