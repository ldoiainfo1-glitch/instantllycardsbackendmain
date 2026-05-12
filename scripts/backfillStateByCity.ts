/**
 * Populate `state` on user 754's BusinessPromotion rows based on `city`.
 * Also normalises the "Kolkatta" misspelling to "Kolkata".
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const SEED_USER_ID = 754;

// city (lowercase) -> { state, canonicalCity }
const CITY_STATE: Record<string, { state: string; canonicalCity: string }> = {
  ahmedabad: { state: 'Gujarat', canonicalCity: 'Ahmedabad' },
  bengaluru: { state: 'Karnataka', canonicalCity: 'Bengaluru' },
  bangalore: { state: 'Karnataka', canonicalCity: 'Bengaluru' },
  chennai: { state: 'Tamil Nadu', canonicalCity: 'Chennai' },
  delhi: { state: 'Delhi', canonicalCity: 'Delhi' },
  hyderabad: { state: 'Telangana', canonicalCity: 'Hyderabad' },
  kolkata: { state: 'West Bengal', canonicalCity: 'Kolkata' },
  kolkatta: { state: 'West Bengal', canonicalCity: 'Kolkata' }, // common misspelling
  mumbai: { state: 'Maharashtra', canonicalCity: 'Mumbai' },
  pune: { state: 'Maharashtra', canonicalCity: 'Pune' },
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL!;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

  try {
    // Distinct cities currently in user's rows
    const cities: { city: string | null; count: bigint }[] = await prisma.$queryRawUnsafe(
      `SELECT city, COUNT(*)::bigint AS count FROM "BusinessPromotion" WHERE user_id = $1 GROUP BY city ORDER BY 2 DESC`,
      SEED_USER_ID
    );
    console.log('Before:');
    console.table(cities.map(c => ({ city: c.city, count: Number(c.count) })));

    let totalUpdated = 0;
    for (const { city } of cities) {
      if (!city) continue;
      const key = city.trim().toLowerCase();
      const map = CITY_STATE[key];
      if (!map) {
        console.warn(`  ⚠ no mapping for city="${city}"; skipping`);
        continue;
      }
      const t0 = Date.now();
      const r = await prisma.businessPromotion.updateMany({
        where: { user_id: SEED_USER_ID, city },
        data: { city: map.canonicalCity, state: map.state },
      });
      totalUpdated += r.count;
      console.log(`  "${city}" -> city="${map.canonicalCity}", state="${map.state}"  (${r.count} rows, ${Date.now() - t0}ms)`);
    }
    console.log(`\nTotal rows updated: ${totalUpdated}`);

    const after: { city: string | null; state: string | null; count: bigint }[] =
      await prisma.$queryRawUnsafe(
        `SELECT city, state, COUNT(*)::bigint AS count FROM "BusinessPromotion" WHERE user_id = $1 GROUP BY city, state ORDER BY 3 DESC`,
        SEED_USER_ID
      );
    console.log('\nAfter:');
    console.table(after.map(r => ({ city: r.city, state: r.state, count: Number(r.count) })));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
