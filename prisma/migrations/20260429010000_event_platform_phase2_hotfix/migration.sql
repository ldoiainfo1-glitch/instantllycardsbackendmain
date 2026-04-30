-- ============================================================
-- Phase 2 hotfixes — additive only, idempotent.
--   • qr_code lookup index (scanner/check-in performance)
--   • RazorpayWebhookEvent.status column
--   • RazorpayWebhookEvent.payload nullable
-- ============================================================

-- Fix 7: qr_code lookup index
CREATE INDEX IF NOT EXISTS "EventRegistration_qr_code_idx"
  ON "EventRegistration"("qr_code");

-- Fix 8: webhook status field
ALTER TABLE "RazorpayWebhookEvent"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'received';

CREATE INDEX IF NOT EXISTS "RazorpayWebhookEvent_status_idx"
  ON "RazorpayWebhookEvent"("status");

-- Fix 8: relax payload to nullable (some Razorpay events may arrive without
-- a body during retries / probes). Safe DROP NOT NULL — no data change.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'RazorpayWebhookEvent'
      AND column_name = 'payload'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "RazorpayWebhookEvent" ALTER COLUMN "payload" DROP NOT NULL;
  END IF;
END$$;
