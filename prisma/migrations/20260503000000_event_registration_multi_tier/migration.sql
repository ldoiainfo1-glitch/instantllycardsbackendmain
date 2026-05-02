-- AllowMultiTierRegistration
-- Drop the old (user_id, event_id) unique constraint so a user can have
-- one registration row per ticket tier for the same event.
ALTER TABLE "EventRegistration"
  DROP CONSTRAINT IF EXISTS "EventRegistration_user_event_unique";

-- Add new unique constraint: one row per (user, event, tier).
-- NULL ticket_tier_id (legacy rows) is treated as distinct by PostgreSQL,
-- so legacy single-registration behaviour is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS "EventRegistration_user_event_tier_unique"
  ON "EventRegistration"("user_id", "event_id", "ticket_tier_id");
