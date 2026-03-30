-- AlterTable
ALTER TABLE "BusinessCard" ADD COLUMN     "approval_status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "is_live" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "service_mode" TEXT;
