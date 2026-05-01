require('dotenv/config');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool
  .query(
    'ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS cancelled_count INTEGER NOT NULL DEFAULT 0'
  )
  .then((r) => {
    console.log('SUCCESS:', r.command);
    process.exit(0);
  })
  .catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
  })
  .finally(() => pool.end());
