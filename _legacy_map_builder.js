// Temporary: build the legacy mapping table from DB data — DELETE after use
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const pg = require('pg');
require('dotenv/config');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  // Get all L0 root names
  const roots = await prisma.category.findMany({
    where: { parent_id: null, is_active: true },
    select: { id: true, name: true },
  });
  const rootNames = new Set(roots.map(r => r.name));
  
  // Get all category names (any level)
  const allCats = await prisma.category.findMany({
    where: { is_active: true },
    select: { name: true },
  });
  const allCatNames = new Set(allCats.map(c => c.name));

  // Get all distinct promo values that DON'T match any category name
  const promoVals = await prisma.$queryRawUnsafe(`
    SELECT val, cnt FROM (
      SELECT unnest(category) AS val, COUNT(*) AS cnt
      FROM "BusinessPromotion"
      WHERE array_length(category, 1) > 0
      GROUP BY unnest(category)
    ) sub
    ORDER BY cnt DESC
  `);

  const noMatch = promoVals
    .filter(r => !allCatNames.has(r.val.trim()))
    .map(r => ({ val: r.val.trim(), cnt: Number(r.cnt) }));

  console.log(`\nTop 80 NO-MATCH promo values (need legacy mapping):\n`);
  console.log(`${'Rank'.padStart(4)} | ${'Count'.padStart(6)} | Value`);
  console.log(`${'─'.repeat(4)} | ${'─'.repeat(6)} | ${'─'.repeat(50)}`);
  noMatch.slice(0, 80).forEach((r, i) => {
    console.log(`${String(i+1).padStart(4)} | ${String(r.cnt).padStart(6)} | "${r.val}"`);
  });

  // Now check: which L0 root names are NOT found in promo data at all?
  const promoValSet = new Set(promoVals.map(r => r.val.trim()));
  console.log(`\n\nL0 roots NOT in promo data (these had their promos stored under old names):`);
  roots.filter(r => !promoValSet.has(r.name)).forEach(r => {
    console.log(`  "${r.name}" (id=${r.id})`);
  });

  // For each no-match value, try to find the closest L0 root by checking if
  // any promotion that has this legacy value ALSO has a known root value
  console.log(`\n\n=== CO-OCCURRENCE ANALYSIS ===`);
  console.log(`For each top legacy value, find which L0 root names appear in the SAME promotions:\n`);
  
  const rootNamesArr = roots.map(r => r.name);
  for (const leg of noMatch.slice(0, 50)) {
    const coRows = await prisma.$queryRawUnsafe(`
      SELECT unnest(category) AS co_val, COUNT(*) AS cnt
      FROM "BusinessPromotion"
      WHERE $1 = ANY(category)
      GROUP BY unnest(category)
      ORDER BY cnt DESC
      LIMIT 10
    `, leg.val);
    
    const coRoots = coRows
      .filter(r => rootNames.has(r.co_val.trim()) && r.co_val.trim() !== leg.val)
      .map(r => `"${r.co_val.trim()}"(${Number(r.cnt)})`);
    
    if (coRoots.length > 0) {
      console.log(`"${leg.val}" (${leg.cnt}x) → co-occurs with roots: ${coRoots.join(', ')}`);
    } else {
      console.log(`"${leg.val}" (${leg.cnt}x) → NO co-occurring root found`);
    }
  }

  await prisma.$disconnect();
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
