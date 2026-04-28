-- Allow a voucher to be claimed by multiple users.
-- Drops the partial unique index that previously enforced
-- "one active owner per voucher" so any user (within max_claims
-- and before expiry) can claim it.

DROP INDEX IF EXISTS "VoucherClaim_one_active_owner_idx";
