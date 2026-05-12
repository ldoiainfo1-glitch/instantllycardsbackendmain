/**
 * Deduplicate the Category table.
 *
 * Group key: (LOWER(TRIM(name)), parent_id, level)
 * Keeper:    row with smallest id in each group.
 *
 * Before deleting duplicates, repoint:
 *   - BusinessCardCategory.category_id  -> keeper.id
 *     (skip the update if it would violate the unique constraint;
 *      that mapping is already covered by the keeper.)
 *   - Category.parent_id                -> keeper.id
 *     (so any sub-categories stay attached.)
 *
 * Run with DRY_RUN=1 to see the plan without writing anything.
 *
 *   npx ts-node scripts/dedupCategories.ts            # write
 *   DRY_RUN=1 npx ts-node scripts/dedupCategories.ts  # preview
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { Pool, PoolClient } from 'pg';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    console.log(`Dry run: ${DRY_RUN}\n`);

    const before = await client.query('SELECT COUNT(*)::int n FROM "Category"');
    console.log(`Category rows before: ${before.rows[0].n}`);

    // Build groups: keeper id + list of duplicate ids
    const groupsRes = await client.query(`
      SELECT
        MIN(id)                       AS keeper_id,
        array_agg(id ORDER BY id)     AS all_ids,
        LOWER(TRIM(name))             AS norm_name,
        parent_id,
        level,
        COUNT(*)::int                 AS cnt
      FROM "Category"
      GROUP BY LOWER(TRIM(name)), parent_id, level
      HAVING COUNT(*) > 1
    `);
    const groups = groupsRes.rows as Array<{
      keeper_id: number;
      all_ids: number[];
      norm_name: string;
      parent_id: number | null;
      level: number;
      cnt: number;
    }>;

    const totalDupRows = groups.reduce((s, g) => s + (g.all_ids.length - 1), 0);
    console.log(`Duplicate groups: ${groups.length}`);
    console.log(`Duplicate rows to remove (keeping 1 per group): ${totalDupRows}\n`);

    if (DRY_RUN) {
      console.log('Top 10 groups by size:');
      console.table(
        groups
          .slice()
          .sort((a, b) => b.cnt - a.cnt)
          .slice(0, 10)
          .map(g => ({
            keeper: g.keeper_id,
            parent_id: g.parent_id,
            level: g.level,
            name: g.norm_name,
            duplicates: g.all_ids.length - 1,
          }))
      );
      return;
    }

    // ---- WRITE PHASE ----
    await client.query('BEGIN');

    let bccUpdated = 0;
    let bccSkipped = 0;
    let parentUpdated = 0;
    let deleted = 0;
    let processed = 0;

    for (const g of groups) {
      const keeper = g.keeper_id;
      const dupIds = g.all_ids.filter(id => id !== keeper);
      if (dupIds.length === 0) continue;

      // 1) Repoint BusinessCardCategory rows that point at any duplicate.
      //    Use ON CONFLICT to silently drop ones that would violate
      //    the unique (business_card_id, category_id) constraint.
      const bcc = await client.query(
        `
        WITH moved AS (
          DELETE FROM "BusinessCardCategory"
          WHERE category_id = ANY($1::int[])
          RETURNING business_card_id
        )
        INSERT INTO "BusinessCardCategory" (business_card_id, category_id)
        SELECT business_card_id, $2::int FROM moved
        ON CONFLICT (business_card_id, category_id) DO NOTHING
        RETURNING 1
        `,
        [dupIds, keeper]
      );
      bccUpdated += bcc.rowCount ?? 0;

      // 2) Repoint Category.parent_id rows that point at any duplicate.
      const par = await client.query(
        `UPDATE "Category" SET parent_id = $1 WHERE parent_id = ANY($2::int[])`,
        [keeper, dupIds]
      );
      parentUpdated += par.rowCount ?? 0;

      // 3) Delete the duplicate Category rows.
      const del = await client.query(
        `DELETE FROM "Category" WHERE id = ANY($1::int[])`,
        [dupIds]
      );
      deleted += del.rowCount ?? 0;

      processed++;
      if (processed % 200 === 0) {
        console.log(`  processed ${processed}/${groups.length} groups (deleted=${deleted})`);
      }
    }

    // Also count how many BCC rows were dropped due to ON CONFLICT.
    // Easier metric: BCC rows pointing at dups before vs after = bccUpdated reported here is the
    // number of *re-inserts* that survived (after dedup). We logged it as bccUpdated already.
    bccSkipped = 0; // ON CONFLICT-skipped rows aren't returned; leaving 0 to indicate not tracked.

    await client.query('COMMIT');

    console.log('\n--- DONE ---');
    console.log(`Groups processed: ${processed}`);
    console.log(`Category rows deleted: ${deleted}`);
    console.log(`BusinessCardCategory rows re-pointed (kept): ${bccUpdated}`);
    console.log(`Category.parent_id rows re-pointed: ${parentUpdated}`);

    const after = await client.query('SELECT COUNT(*)::int n FROM "Category"');
    console.log(`Category rows after: ${after.rows[0].n}`);

    // Re-check for any remaining duplicate groups
    const remain = await client.query(`
      SELECT COUNT(*)::int n FROM (
        SELECT 1 FROM "Category"
        GROUP BY LOWER(TRIM(name)), parent_id, level
        HAVING COUNT(*) > 1
      ) t
    `);
    console.log(`Remaining duplicate groups: ${remain.rows[0].n}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
