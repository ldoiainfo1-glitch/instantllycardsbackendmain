/**
 * Phone Cleanup Script
 * Run ONCE to strip country codes from all phone numbers in the DB.
 *
 * Rules:
 *  - "+919373193179" → "9373193179"
 *  - "919373193179"  → "9373193179"  (starts with 91 and length > 10)
 *  - "9373193179"    → "9373193179"  (already clean, no-op)
 *
 * Safe to re-run (idempotent).
 * Usage: npx ts-node src/scripts/cleanPhones.ts
 */
import 'dotenv/config';
