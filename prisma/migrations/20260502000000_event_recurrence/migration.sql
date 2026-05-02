-- AddRecurrenceToEvent
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "recurrence_rule" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "recurrence_ends_at" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "parent_event_id" INTEGER;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_parent_event_id_fkey"
  FOREIGN KEY ("parent_event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_parent_event_id_fkey";

CREATE INDEX IF NOT EXISTS "Event_parent_event_id_idx" ON "Event"("parent_event_id");
