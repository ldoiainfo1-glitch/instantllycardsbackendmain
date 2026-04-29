-- Phase 5 — Production lifecycle features.
-- Idempotent. Safe to run on production.
--
-- Adds two nullable timestamp columns on Event used by the reminder cron
-- to dedupe dispatches (set-once-then-skip). Both default NULL so all
-- existing 900+ events behave as "never reminded yet" — the cron will
-- only consider events whose date is within the dispatch window, so
-- this is safe.

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at" TIMESTAMP(3);

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "reminder_2h_sent_at"  TIMESTAMP(3);
