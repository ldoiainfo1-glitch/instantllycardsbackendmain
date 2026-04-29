-- Phase 3 hardening — DB-level duplicate registration protection.
-- Idempotent. Safe to run on production.
--
-- 1) De-duplicate any pre-existing rows by keeping the EARLIEST registration
--    per (user_id, event_id). The application already checks for duplicates
--    via findFirst, so in practice this should be a no-op, but we run it
--    defensively before adding the unique constraint to avoid migration
--    failure on dirty data.

DELETE FROM "EventRegistration" a
USING "EventRegistration" b
WHERE a.id > b.id
  AND a.user_id  = b.user_id
  AND a.event_id = b.event_id;

-- 2) Add the composite unique index. CONCURRENTLY would be ideal but
--    Prisma migrations run inside a transaction, so we use a regular index.
--    On a healthy 900-event dataset this is sub-second.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'EventRegistration_user_event_unique'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX "EventRegistration_user_event_unique"
             ON "EventRegistration" ("user_id", "event_id")';
  END IF;
END$$;

-- 3) Index on payment_order_id for cheap reuse-protection lookups.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'EventRegistration_payment_order_id_idx'
  ) THEN
    EXECUTE 'CREATE INDEX "EventRegistration_payment_order_id_idx"
             ON "EventRegistration" ("payment_order_id")';
  END IF;
END$$;
