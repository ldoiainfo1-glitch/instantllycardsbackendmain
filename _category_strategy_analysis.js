// Temporary analysis script — DELETE after investigation
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const pg = require('pg');
require('dotenv/config');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  console.log('=== STEP 1-3: TREE TRAVERSAL VERIFICATION ===\n');

  // Example: "AC AMC Service" — find its chain
  const leaf = await prisma.category.findFirst({ where: { name: 'AC AMC Service', is_active: true } });
  if (leaf) {
    const parent = leaf.parent_id ? await prisma.category.findUnique({ where: { id: leaf.parent_id } }) : null;
    const root = parent?.parent_id ? await prisma.category.findUnique({ where: { id: parent.parent_id } }) : null;
    console.log('Chain for "AC AMC Service":');
    console.log(JSON.stringify({ leaf: { id: leaf.id, name: leaf.name, level: leaf.level }, parent: parent ? { id: parent.id, name: parent.name, level: parent.level } : null, root: root ? { id: root.id, name: root.name, level: root.level } : null }, null, 2));
  } else {
    console.log('"AC AMC Service" not found in Category table');
  }

  // Verify a few more
  for (const leafName of ['AC Repair', '1 BHK For Rent', 'IIT Coaching', 'Furniture Repair', 'Bridal Makeup']) {
    const l = await prisma.category.findFirst({ where: { name: leafName, is_active: true } });
    if (l) {
      const p = l.parent_id ? await prisma.category.findUnique({ where: { id: l.parent_id } }) : null;
      const r = p?.parent_id ? await prisma.category.findUnique({ where: { id: p.parent_id } }) : null;
      console.log(`\nChain for "${leafName}":`);
      console.log(`  leaf(L${l.level}): "${l.name}" → parent(L${p?.level}): "${p?.name}" → root(L${r?.level}): "${r?.name}"`);
    }
  }

  console.log('\n\n=== STEP 5: VALIDATE PROMO VALUES AGAINST TREE ===\n');

  // 5a. Get ALL distinct promo category values
  const promoValuesRaw = await prisma.$queryRawUnsafe(`
    SELECT val, cnt FROM (
      SELECT unnest(category) AS val, COUNT(*) AS cnt 
      FROM "BusinessPromotion" 
      WHERE array_length(category, 1) > 0
      GROUP BY unnest(category)
    ) sub
    ORDER BY cnt DESC
  `);
  const promoValues = promoValuesRaw.map(r => ({ val: r.val, cnt: Number(r.cnt) }));
  console.log(`Total distinct promo category values: ${promoValues.length}`);

  // 5b. Get all category names by level
  const allCats = await prisma.category.findMany({
    where: { is_active: true },
    select: { id: true, name: true, level: true, parent_id: true },
  });
  const l0Names = new Set(allCats.filter(c => c.level === 0).map(c => c.name));
  const l1Names = new Set(allCats.filter(c => c.level === 1).map(c => c.name));
  const l2Names = new Set(allCats.filter(c => c.level === 2).map(c => c.name));
  const allNames = new Set(allCats.map(c => c.name));

  // 5c. Classify every promo value
  let matchRoot = 0, matchL1 = 0, matchL2 = 0, matchNone = 0;
  let matchRootOccurrences = 0, matchL1Occurrences = 0, matchL2Occurrences = 0, matchNoneOccurrences = 0;
  const rootMatches = [];
  const l1Matches = [];
  const l2Matches = [];
  const noMatches = [];

  for (const pv of promoValues) {
    const trimmed = pv.val.trim();
    if (l0Names.has(trimmed)) {
      matchRoot++;
      matchRootOccurrences += pv.cnt;
      if (rootMatches.length < 20) rootMatches.push({ val: trimmed, cnt: pv.cnt });
    } else if (l1Names.has(trimmed)) {
      matchL1++;
      matchL1Occurrences += pv.cnt;
      if (l1Matches.length < 20) l1Matches.push({ val: trimmed, cnt: pv.cnt });
    } else if (l2Names.has(trimmed)) {
      matchL2++;
      matchL2Occurrences += pv.cnt;
      if (l2Matches.length < 20) l2Matches.push({ val: trimmed, cnt: pv.cnt });
    } else {
      matchNone++;
      matchNoneOccurrences += pv.cnt;
      if (noMatches.length < 30) noMatches.push({ val: trimmed, cnt: pv.cnt });
    }
  }

  const totalOcc = matchRootOccurrences + matchL1Occurrences + matchL2Occurrences + matchNoneOccurrences;

  console.log('\n--- Classification of BusinessPromotion.category[] values ---');
  console.log(`Matches L0 ROOT:  ${matchRoot} distinct values (${matchRootOccurrences} occurrences, ${(matchRootOccurrences/totalOcc*100).toFixed(1)}%)`);
  console.log(`Matches L1:       ${matchL1} distinct values (${matchL1Occurrences} occurrences, ${(matchL1Occurrences/totalOcc*100).toFixed(1)}%)`);
  console.log(`Matches L2 LEAF:  ${matchL2} distinct values (${matchL2Occurrences} occurrences, ${(matchL2Occurrences/totalOcc*100).toFixed(1)}%)`);
  console.log(`Matches NOTHING:  ${matchNone} distinct values (${matchNoneOccurrences} occurrences, ${(matchNoneOccurrences/totalOcc*100).toFixed(1)}%)`);
  console.log(`TOTAL:            ${promoValues.length} distinct, ${totalOcc} occurrences`);

  console.log('\nTop ROOT matches (promo values that ARE L0 names):');
  rootMatches.forEach(m => console.log(`  "${m.val}" → ${m.cnt}x`));

  console.log('\nTop L1 matches (promo values that ARE L1 names):');
  l1Matches.forEach(m => console.log(`  "${m.val}" → ${m.cnt}x`));

  console.log('\nTop L2 matches (promo values that ARE L2 leaf names):');
  l2Matches.forEach(m => console.log(`  "${m.val}" → ${m.cnt}x`));

  console.log('\nTop NO-MATCH values (promo values not in ANY category level):');
  noMatches.forEach(m => console.log(`  "${m.val}" → ${m.cnt}x`));

  // 5d. Case-insensitive check for no-match values
  console.log('\n--- Case-insensitive re-check of NO-MATCH values ---');
  const allNamesLower = new Map();
  allCats.forEach(c => allNamesLower.set(c.name.toLowerCase().trim(), { name: c.name, level: c.level }));
  
  let ciRescued = 0;
  for (const nm of noMatches.slice(0, 30)) {
    const lower = nm.val.toLowerCase().trim();
    if (allNamesLower.has(lower)) {
      const match = allNamesLower.get(lower);
      console.log(`  "${nm.val}" → case-insensitive match: "${match.name}" (L${match.level})`);
      ciRescued++;
    }
  }
  console.log(`Case-insensitive rescued: ${ciRescued} of top 30 no-matches`);

  // 5e. Check if mobile frontend categories are different from L0
  console.log('\n\n=== MOBILE FRONTEND CATEGORIES vs L0 ROOT ===\n');
  const mobileRoots = await prisma.category.findMany({
    where: { parent_id: null, is_active: true },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, level: true },
  });
  console.log(`Mobile root categories (parent_id IS NULL): ${mobileRoots.length}`);
  mobileRoots.forEach(c => console.log(`  id=${c.id} level=${c.level} "${c.name}"`));

  // Compare with level=0
  const l0Cats = await prisma.category.findMany({
    where: { level: 0, is_active: true },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, parent_id: true },
  });
  console.log(`\nLevel=0 categories: ${l0Cats.length}`);
  
  // Find differences
  const mobileNames = new Set(mobileRoots.map(c => c.name));
  const l0NamesArr = l0Cats.map(c => c.name);
  const inMobileNotL0 = mobileRoots.filter(c => !l0Names.has(c.name));
  const inL0NotMobile = l0Cats.filter(c => !mobileNames.has(c.name));
  
  if (inMobileNotL0.length > 0) {
    console.log(`\nIn MOBILE roots but NOT in L0:`);
    inMobileNotL0.forEach(c => console.log(`  "${c.name}" (id=${c.id}, level=${c.level})`));
  }
  if (inL0NotMobile.length > 0) {
    console.log(`\nIn L0 but NOT in MOBILE roots:`);
    inL0NotMobile.forEach(c => console.log(`  "${c.name}" (id=${c.id})`));
  }

  // 5f. Check: Do promotions store the MOBILE root names or the L0 names?
  console.log('\n\n=== DO PROMO VALUES MATCH MOBILE ROOT NAMES? ===\n');
  const promoValueSet = new Set(promoValues.map(pv => pv.val.trim()));
  const promoValueSetLower = new Set(promoValues.map(pv => pv.val.trim().toLowerCase()));
  
  let mobileMatchExact = 0, mobileMatchCI = 0;
  for (const mc of mobileRoots) {
    const exactMatch = promoValueSet.has(mc.name);
    const ciMatch = promoValueSetLower.has(mc.name.toLowerCase());
    if (exactMatch) mobileMatchExact++;
    else if (ciMatch) mobileMatchCI++;
    console.log(`  "${mc.name}" → exact: ${exactMatch}, case-insensitive: ${ciMatch}`);
  }
  console.log(`\nMobile root names found in promo data: ${mobileMatchExact} exact, ${mobileMatchCI} case-insensitive-only`);

  await prisma.$disconnect();
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
