-- Add company_logo and venue_images to Event model
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "company_logo" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "venue_images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
