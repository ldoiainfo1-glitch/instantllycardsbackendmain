import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const databaseUrl =
  (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL) ||
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const needsSsl =
  /supabase\.com|pooler\.supabase\.com/i.test(databaseUrl) ||
  /sslmode=require/i.test(databaseUrl);

// Warn (loudly) if production is still pointing at Supabase Session-mode pooler
// (port 5432). Session mode caps clients at ~15 and was the root cause of past
// MaxClientsInSessionMode outages. Use port 6543 (Transaction mode) instead.
if (
  process.env.NODE_ENV === 'production' &&
  /pooler\.supabase\.com:5432/.test(databaseUrl)
) {
  // eslint-disable-next-line no-console
  console.warn(
    '[prisma] ⚠️  DATABASE_URL is using Supabase SESSION pooler (:5432). ' +
      'Switch to TRANSACTION pooler (:6543) to avoid MaxClientsInSessionMode errors.'
  );
}

const POOL_MAX = parseInt(process.env.DB_POOL_MAX ?? '5', 10);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: POOL_MAX,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

// Surface pool-level errors so they don't crash the process silently.
pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[prisma] pg pool error:', err.message);
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter } as any);

// Graceful shutdown — release pooler slots on SIGTERM/SIGINT (PM2 reload, etc.)
//
// IMPORTANT: we MUST `process.exit()` after closing the pool. Otherwise the
// Express server keeps holding the port and continues accepting requests
// against a dead pool, producing
//   "Cannot use a pool after calling end on the pool"
// on every subsequent query.
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`[prisma] ${signal} received, closing DB pool…`);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  // Give logs a tick to flush, then exit.
  setTimeout(() => process.exit(0), 50).unref();
};
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

export default prisma;
