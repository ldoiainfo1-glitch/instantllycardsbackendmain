require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const p = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });

(async () => {
  // ============ PART 1: Full category tree ============
  const all = await p.category.findMany({
    where: { is_active: true },
    select: { id: true, name: true, parent_id: true, level: true, sort_order: true },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
  });

  // Build tree
  const byParent = new Map();
  const byId = new Map();
  for (const c of all) {
    byId.set(c.id, c);
    if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
    byParent.get(c.parent_id).push(c);
  }

  const roots = byParent.get(null) || [];
  console.log(`=== CATEGORY TREE: ${all.length} total nodes, ${roots.length} roots ===\n`);

  // Print tree
  const printTree = (parentId, depth, limit) => {
    const children = byParent.get(parentId) || [];
    for (const c of children) {
      const indent = '  '.repeat(depth);
      const marker = depth === 0 ? '📁' : depth === 1 ? '├──' : '│   ├──';
      const childCount = (byParent.get(c.id) || []).length;
      const leafTag = childCount === 0 ? ' [LEAF]' : ` (${childCount} children)`;
      if (limit && depth === 0) {
        console.log(`${marker} [L${c.level}] "${c.name}" (id:${c.id})${leafTag}`);
      }
      if (depth > 0 || !limit) {
        console.log(`${indent}${marker} [L${c.level}] "${c.name}" (id:${c.id})${leafTag}`);
      }
      if (!limit || depth > 0) printTree(c.id, depth + 1, false);
    }
  };

  // Print just root names first
  console.log('--- ALL ROOT CATEGORIES (Level 0) ---');
  for (const r of roots) {
    const childCount = (byParent.get(r.id) || []).length;
    console.log(`  📁 "${r.name}" (id:${r.id}, ${childCount} children)`);
  }

  // ============ PART 2: AC-related tree (detailed) ============
  console.log('\n\n=== AC-RELATED TREE (DETAILED) ===');
  const acRoots = roots.filter(r =>
    r.name.toLowerCase().includes('ac') ||
    r.name.toLowerCase().includes('appliance') ||
    r.name.toLowerCase().includes('home')
  );
  for (const r of acRoots) {
    console.log(`\n📁 [L${r.level}] "${r.name}" (id:${r.id})`);
    const children = byParent.get(r.id) || [];
    for (const c of children) {
      const grandchildren = byParent.get(c.id) || [];
      console.log(`  ├── [L${c.level}] "${c.name}" (id:${c.id}) → ${grandchildren.length} leaves`);
      for (const g of grandchildren) {
        console.log(`  │   ├── [L${g.level}] "${g.name}" (id:${g.id}) [LEAF]`);
      }
    }
  }

  // ============ PART 3: Level breakdown ============
  console.log('\n\n=== LEVEL BREAKDOWN ===');
  const levels = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const c of all) levels[c.level] = (levels[c.level] || 0) + 1;
  for (const [lv, cnt] of Object.entries(levels)) {
    if (cnt > 0) console.log(`  Level ${lv}: ${cnt} nodes`);
  }

  // ============ PART 4: All leaf nodes ============
  const leaves = all.filter(c => !(byParent.get(c.id) || []).length);
  console.log(`\n=== LEAF CATEGORIES (${leaves.length} total) — first 50 ===`);
  for (const l of leaves.slice(0, 50)) {
    const parent = byId.get(l.parent_id);
    console.log(`  "${l.name}" (id:${l.id}, parent:"${parent?.name || 'ROOT'}")`);
  }

  // ============ PART 5: Compare with BusinessPromotion.category[] ============
  console.log('\n\n=== MISMATCH ANALYSIS ===');

  // Get top 30 promotion category values
  const promoVals = await p.$queryRawUnsafe(
    `SELECT unnest(category) as cat, COUNT(*) as cnt FROM "BusinessPromotion" WHERE status='active' AND array_length(category,1)>0 GROUP BY cat ORDER BY cnt DESC LIMIT 30`
  );
  console.log('\n--- Top 30 BusinessPromotion.category[] values ---');
  for (const v of promoVals) console.log(`  ${v.cnt}x "${v.cat}"`);

  // Check overlap: how many leaf category names exist in promo data
  const leafNames = new Set(leaves.map(l => l.name));
  const promoNames = new Set(promoVals.map(v => v.cat));

  const inBoth = [...leafNames].filter(n => promoNames.has(n));
  const leafOnly = [...leafNames].filter(n => !promoNames.has(n));
  const promoOnly = [...promoNames].filter(n => !leafNames.has(n));

  console.log(`\n--- Overlap (leaf names in top promo values) ---`);
  console.log(`  In both: ${inBoth.length}`);
  inBoth.slice(0, 10).forEach(n => console.log(`    ✅ "${n}"`));
  console.log(`  Leaf-only (not in promo data): ${leafOnly.length}`);
  leafOnly.slice(0, 10).forEach(n => console.log(`    ❌ "${n}"`));
  console.log(`  Promo-only (not a leaf category): ${promoOnly.length}`);
  promoOnly.slice(0, 10).forEach(n => console.log(`    ⚠️  "${n}"`));

  // Deeper: check ALL promo distinct values vs ALL leaf names
  const allPromoVals = await p.$queryRawUnsafe(
    `SELECT DISTINCT unnest(category) as cat FROM "BusinessPromotion" WHERE status='active' AND array_length(category,1)>0`
  );
  const allPromoSet = new Set(allPromoVals.map(v => v.cat));
  const allLeafInPromo = [...leafNames].filter(n => allPromoSet.has(n));
  const allLeafNotInPromo = [...leafNames].filter(n => !allPromoSet.has(n));

  console.log(`\n--- Full overlap: ALL leaf names vs ALL promo values ---`);
  console.log(`  Total leaf names: ${leafNames.size}`);
  console.log(`  Total distinct promo values: ${allPromoSet.size}`);
  console.log(`  Leaf names found in promo data: ${allLeafInPromo.length} (${(allLeafInPromo.length/leafNames.size*100).toFixed(1)}%)`);
  console.log(`  Leaf names NOT in promo data: ${allLeafNotInPromo.length} (${(allLeafNotInPromo.length/leafNames.size*100).toFixed(1)}%)`);

  // Also check root (L0) names in promo data
  const rootNames = new Set(roots.map(r => r.name));
  const rootInPromo = [...rootNames].filter(n => allPromoSet.has(n));
  console.log(`\n  Root (L0) names found in promo data: ${rootInPromo.length} of ${rootNames.size}`);
  rootInPromo.slice(0, 10).forEach(n => console.log(`    ✅ "${n}"`));

  // L1 names in promo data
  const l1 = all.filter(c => c.level === 1);
  const l1Names = new Set(l1.map(c => c.name));
  const l1InPromo = [...l1Names].filter(n => allPromoSet.has(n));
  console.log(`  L1 names found in promo data: ${l1InPromo.length} of ${l1Names.size}`);

  // Promo values NOT in any category level
  const allCatNames = new Set(all.map(c => c.name));
  const promoNotInCat = [...allPromoSet].filter(n => !allCatNames.has(n));
  console.log(`\n  Promo values NOT matching any Category name: ${promoNotInCat.length} of ${allPromoSet.size}`);
  promoNotInCat.slice(0, 15).forEach(n => console.log(`    ⚠️  "${n}"`));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
