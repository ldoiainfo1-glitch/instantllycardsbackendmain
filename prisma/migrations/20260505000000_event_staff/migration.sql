-- CreateTable: EventStaff
-- Roles: "co_organizer" (full edit, no delete) | "scanner" (scan-only, future)
CREATE TABLE "EventStaff" (
    "id"          SERIAL        NOT NULL,
    "event_id"    INTEGER       NOT NULL,
    "user_id"     INTEGER       NOT NULL,
    "role"        TEXT          NOT NULL,
    "invited_by"  INTEGER       NOT NULL,
    "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStaff_pkey" PRIMARY KEY ("id")
);

-- Unique: one role per user per event
ALTER TABLE "EventStaff" ADD CONSTRAINT "EventStaff_event_id_user_id_key" UNIQUE ("event_id", "user_id");

-- Indexes
CREATE INDEX "EventStaff_user_id_idx"   ON "EventStaff"("user_id");
CREATE INDEX "EventStaff_event_id_idx"  ON "EventStaff"("event_id");

-- Foreign Keys
ALTER TABLE "EventStaff"
    ADD CONSTRAINT "EventStaff_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventStaff"
    ADD CONSTRAINT "EventStaff_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventStaff"
    ADD CONSTRAINT "EventStaff_invited_by_fkey"
    FOREIGN KEY ("invited_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
