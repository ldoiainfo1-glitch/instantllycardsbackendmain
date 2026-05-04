-- CreateTable: EventDay
CREATE TABLE IF NOT EXISTS "EventDay" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "day_number" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EventSession
CREATE TABLE IF NOT EXISTS "EventSession" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "day_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "session_type" TEXT NOT NULL DEFAULT 'session',
    "location" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EventSpeaker
CREATE TABLE IF NOT EXISTS "EventSpeaker" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "company" TEXT,
    "bio" TEXT,
    "photo_url" TEXT,
    "linkedin_url" TEXT,
    "twitter_url" TEXT,
    "website_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSpeaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EventSessionSpeaker
CREATE TABLE IF NOT EXISTS "EventSessionSpeaker" (
    "session_id" INTEGER NOT NULL,
    "speaker_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'speaker',

    CONSTRAINT "EventSessionSpeaker_pkey" PRIMARY KEY ("session_id","speaker_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EventDay_event_id_day_number_key" ON "EventDay"("event_id", "day_number");
CREATE INDEX IF NOT EXISTS "EventDay_event_id_idx" ON "EventDay"("event_id");
CREATE INDEX IF NOT EXISTS "EventSession_event_id_idx" ON "EventSession"("event_id");
CREATE INDEX IF NOT EXISTS "EventSession_day_id_sort_order_idx" ON "EventSession"("day_id", "sort_order");
CREATE INDEX IF NOT EXISTS "EventSpeaker_event_id_idx" ON "EventSpeaker"("event_id");
CREATE INDEX IF NOT EXISTS "EventSessionSpeaker_speaker_id_idx" ON "EventSessionSpeaker"("speaker_id");

-- AddForeignKey
ALTER TABLE "EventDay" ADD CONSTRAINT "EventDay_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_day_id_fkey"
    FOREIGN KEY ("day_id") REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSpeaker" ADD CONSTRAINT "EventSpeaker_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSessionSpeaker" ADD CONSTRAINT "EventSessionSpeaker_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSessionSpeaker" ADD CONSTRAINT "EventSessionSpeaker_speaker_id_fkey"
    FOREIGN KEY ("speaker_id") REFERENCES "EventSpeaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
