-- Data migration: approve all existing business cards that were created before
-- the approval_status column was added. These cards were never reviewed because
-- the approval workflow didn't exist when they were created.
UPDATE "BusinessCard"
SET "approval_status" = 'approved'
WHERE "approval_status" = 'pending'
  AND "created_at" < '2026-03-30T18:30:14.000Z';
