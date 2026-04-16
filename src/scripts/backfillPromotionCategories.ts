/**
 * Migration: Backfill empty BusinessPromotion.category[] from BusinessCard.category string.
 *
 * Problem:  The frontend never passed `category` when calling createPromotion().
 *           Result: ~49% of promotions have category = '{}' (empty array).
 *           The category IS stored on the linked BusinessCard as a single string.
 *
 * Strategy:
 *   1. Find all promotions where category = '{}' AND business_card_id IS NOT NULL
 *   2. Join with BusinessCard to get the category string
 *   3. Parse "Parent > Sub1, Sub2" → ["Parent", "Sub1", "Sub2"]
 *   4. Resolve each through the Category tree to build the full chain + legacy aliases
 *   5. Update the promotion with the normalized category array
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/backfillPromotionCategories.ts [--dry-run] [--limit N]
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

// --- LEGACY_CATEGORY_MAP (same as promotionController.ts) ---
const LEGACY_CATEGORY_MAP: Record<string, string[]> = {
  'AC Services':              ['Ac & Appliances', 'AC & Appliances', 'AC Repair & Services', 'AC Installation Services'],
  'Agriculture':              ['Fertilizer Dealers'],
  'Apparel & Fashion':        ['Apprael & Fashion', 'Readymade Garment Retailers'],
  'Astrology & Spiritual':    ['Kundali Matching', 'Vastu Consultation'],
  'Automotive':               ['Car Repair & Services', 'Car Dealers'],
  'Beauty & Wellness':        ['Home Services Offered'],
  'Business Services':        ['GST Return', 'Accounting'],
  'Cinemas & Entertainment':  ['Cinema Halls', 'Parking Available'],
  'Cleaning Services':        ['Residential Cleaning Services', 'Eco Friendly Housekeeping', 'Housekeeping Services'],
  'Construction & Interior':  ['Interior Designers', 'Civil Contractors', 'Building'],
  'Digital Services':         ['Digitel Services', 'Digital marketing services', 'Digital Marketing Services'],
  'Education & Training':     ['Tutorials', 'Computer Training Institutes', 'Counselling Sessions'],
  'Electrical Services':      ['Electricians'],
  'Event Services':           ['Event Organisers'],
  'Financial Services':       ['Insurance Agents'],
  'Fitness':                  ['Fitness Centres', 'Gyms', 'Get Your Own Trainer'],
  'Groceries & Supermarkets': ['Grocier & Supermarket', 'Grocery Stores'],
  'Healthcare':               ['General'],
  'Home Maintenance':         ['Plumbers'],
  'IT & Computer':            ['It & Computer', 'Computer Repair & Services'],
  'Jewellery':                ['Jewellery Showrooms', 'Gold Jewellery', 'Pearl Jewellery'],
  'Matrimony':                ['Matrimonial Bureaus'],
  'Mobile Services':          ['Mobile Phone Repair & Services', 'Mobile Phone Dealers'],
  'Pet Services':             ['Pets Available'],
  'Pharmaceuticals & Chemists': ['Chemists'],
  'Placement & Recruitment':  ['Placement & Recruitments', 'Placement Services (Candidate)'],
  'Printing & Publishing':    ['Flex', 'Book', 'Digital'],
  'Real Estate':              ['Estate Agents For Residential Rental', 'Real Estate Agents', 'Estate Agents For Residence', 'Estate Agents For Commercial Rental'],
  'Scrap':                    ['Battery Scrap', 'Scrap Dealers'],
  'Security Services':        ['Bodyguard'],
  'Telecom & Internet Services': ['Internet Service Providers', 'Wifi Internet Service Providers'],
  'Transport':                ['Transporters'],
  'Travel & Tourism':         ['Travel Agents'],
  'Warehouse':                ['Warehouses On Rent'],
};

// --- Helpers (same logic as promotionController.ts) ---

function parseCategoryString(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('Custom:')) {
    const custom = trimmed.slice('Custom:'.length).trim();
    return custom ? [custom] : [];
  }

  if (trimmed.includes('>')) {
    const [parentPart, ...rest] = trimmed.split('>');
    const parent = parentPart.trim();
    const subs = rest.join('>').split(',').map(s => s.trim()).filter(Boolean);
    const result: string[] = [];
    if (parent) result.push(parent);
    for (const sub of subs) {
      if (!result.includes(sub)) result.push(sub);
    }
    return result;
  }

  return [trimmed];
}

async function resolveCategoryChain(categoryName: string): Promise<string[]> {
  const trimmed = categoryName.trim();
  if (!trimmed) return [trimmed];

  const node = await prisma.category.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' }, is_active: true },
    select: { id: true, name: true, parent_id: true },
  });

  if (!node) return [trimmed];

  const names: string[] = [node.name];
  let currentParentId = node.parent_id;
  while (currentParentId !== null) {
    const parentNode = await prisma.category.findUnique({
      where: { id: currentParentId },
      select: { id: true, name: true, parent_id: true },
    });
    if (!parentNode) break;
    names.push(parentNode.name);
    currentParentId = parentNode.parent_id;
  }

  return [...new Set(names)];
}

async function buildCategoryMatchSet(categoryName: string): Promise<string[]> {
  const chain = await resolveCategoryChain(categoryName);
  const root = chain[chain.length - 1];
  const legacyMatches = LEGACY_CATEGORY_MAP[root] || [];
  return [...new Set([...chain, ...legacyMatches])];
}

// --- Main migration ---

async function main() {
  console.log(`\n=== Backfill Promotion Categories ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);
  console.log('');

  // Step 1: Find promotions with empty category that have a linked business card
  const emptyPromos = await prisma.businessPromotion.findMany({
    where: {
      category: { equals: [] },
      business_card_id: { not: null },
    },
    select: {
      id: true,
      business_card_id: true,
      business_name: true,
    },
    ...(LIMIT ? { take: LIMIT } : {}),
    orderBy: { id: 'asc' },
  });

  console.log(`Found ${emptyPromos.length} promotions with empty category + linked card\n`);

  // Also count promotions with empty category and NO linked card
  const orphanCount = await prisma.businessPromotion.count({
    where: {
      category: { equals: [] },
      business_card_id: null,
    },
  });
  console.log(`(${orphanCount} promotions have empty category AND no linked card — cannot recover)\n`);

  let updated = 0;
  let skipped = 0;
  let noCardCategory = 0;

  for (const promo of emptyPromos) {
    // Step 2: Get the linked business card's category
    const card = await prisma.businessCard.findUnique({
      where: { id: promo.business_card_id! },
      select: { category: true },
    });

    if (!card || !card.category || !card.category.trim()) {
      noCardCategory++;
      continue;
    }

    // Step 3: Parse the string
    const rawCategories = parseCategoryString(card.category);
    if (rawCategories.length === 0) {
      noCardCategory++;
      continue;
    }

    // Step 4: Resolve through tree + legacy map
    const resolvedSets = await Promise.all(rawCategories.map(c => buildCategoryMatchSet(c)));
    const normalizedCategory = [...new Set(resolvedSets.flat())];

    if (normalizedCategory.length === 0) {
      skipped++;
      continue;
    }

    // Step 5: Update
    if (DRY_RUN) {
      console.log(`[DRY] Promo ${promo.id} "${promo.business_name}": card.category="${card.category}" → [${normalizedCategory.join(', ')}]`);
    } else {
      await prisma.businessPromotion.update({
        where: { id: promo.id },
        data: { category: normalizedCategory },
      });
    }
    updated++;

    if (updated % 500 === 0) {
      console.log(`  ...processed ${updated} updates`);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Total with empty category + card: ${emptyPromos.length}`);
  console.log(`Updated:                          ${updated}`);
  console.log(`Skipped (empty resolved):         ${skipped}`);
  console.log(`No card category found:           ${noCardCategory}`);
  console.log(`Orphans (no card link):           ${orphanCount}`);
  console.log(`Mode:                             ${DRY_RUN ? 'DRY RUN (no changes written)' : 'LIVE'}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
