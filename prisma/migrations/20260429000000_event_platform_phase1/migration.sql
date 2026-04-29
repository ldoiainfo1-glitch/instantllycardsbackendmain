-- ============================================================
-- Event Platform Phase 1 — additive only, backward compatible
-- ============================================================
-- All new columns are nullable or default-valued so existing
-- 900+ events / registrations continue to work without changes.

-- ----------------------------------------------------------------
-- Event: new columns
-- ----------------------------------------------------------------
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "is_legacy"           BOOLEAN  NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "cancelled_at"        TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "views_count"         INTEGER  NOT NULL DEFAULT 0;

-- Mark all currently-existing events as legacy so phase-2 fallback
-- logic can trust the flag without scanning rows.
UPDATE "Event" SET "is_legacy" = true WHERE "is_legacy" = false;

-- ----------------------------------------------------------------
-- EventRegistration: new columns
-- ----------------------------------------------------------------
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "ticket_tier_id"  INTEGER;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "checked_in"      BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "checked_in_at"   TIMESTAMP(3);
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "checked_in_by"   INTEGER;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "cancelled_at"    TIMESTAMP(3);
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "refund_status"   TEXT;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "refund_id"       TEXT;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "refund_amount"   DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "EventRegistration_event_id_checked_in_idx"
  ON "EventRegistration"("event_id", "checked_in");
CREATE INDEX IF NOT EXISTS "EventRegistration_ticket_tier_id_idx"
  ON "EventRegistration"("ticket_tier_id");

-- ----------------------------------------------------------------
-- EventTicketTier: new table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EventTicketTier" (
  "id"             SERIAL PRIMARY KEY,
  "event_id"       INTEGER NOT NULL,
  "name"           TEXT    NOT NULL,
  "description"    TEXT,
  "price"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency"       TEXT    NOT NULL DEFAULT 'INR',
  "quantity_total" INTEGER,
  "quantity_sold"  INTEGER NOT NULL DEFAULT 0,
  "sort_order"     INTEGER NOT NULL DEFAULT 0,
  "is_active"      BOOLEAN NOT NULL DEFAULT true,
  "sale_starts_at" TIMESTAMP(3),
  "sale_ends_at"   TIMESTAMP(3),
  "min_per_order"  INTEGER NOT NULL DEFAULT 1,
  "max_per_order"  INTEGER NOT NULL DEFAULT 10,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventTicketTier_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "EventTicketTier_event_id_idx"            ON "EventTicketTier"("event_id");
CREATE INDEX IF NOT EXISTS "EventTicketTier_event_id_is_active_idx"  ON "EventTicketTier"("event_id", "is_active");

-- Now that EventTicketTier exists, wire up the FK from EventRegistration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EventRegistration_ticket_tier_id_fkey'
  ) THEN
    ALTER TABLE "EventRegistration"
      ADD CONSTRAINT "EventRegistration_ticket_tier_id_fkey"
      FOREIGN KEY ("ticket_tier_id") REFERENCES "EventTicketTier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- ----------------------------------------------------------------
-- EventWaitlist: new table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EventWaitlist" (
  "id"           SERIAL PRIMARY KEY,
  "event_id"     INTEGER NOT NULL,
  "user_id"      INTEGER NOT NULL,
  "ticket_count" INTEGER NOT NULL DEFAULT 1,
  "position"     INTEGER NOT NULL,
  "status"       TEXT    NOT NULL DEFAULT 'waiting',
  "notified_at"  TIMESTAMP(3),
  "promoted_at"  TIMESTAMP(3),
  "expires_at"   TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventWaitlist_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventWaitlist_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventWaitlist_event_id_user_id_key"
  ON "EventWaitlist"("event_id", "user_id");
CREATE INDEX IF NOT EXISTS "EventWaitlist_event_id_status_position_idx"
  ON "EventWaitlist"("event_id", "status", "position");

-- ----------------------------------------------------------------
-- RazorpayWebhookEvent: idempotency log
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "RazorpayWebhookEvent" (
  "id"           SERIAL PRIMARY KEY,
  "event_id"     TEXT    NOT NULL,
  "event_type"   TEXT    NOT NULL,
  "payload"      JSONB   NOT NULL,
  "processed"    BOOLEAN NOT NULL DEFAULT false,
  "processed_at" TIMESTAMP(3),
  "error"        TEXT,
  "received_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "RazorpayWebhookEvent_event_id_key"
  ON "RazorpayWebhookEvent"("event_id");
CREATE INDEX IF NOT EXISTS "RazorpayWebhookEvent_event_type_processed_idx"
  ON "RazorpayWebhookEvent"("event_type", "processed");
