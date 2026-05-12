/**
 * Find duplicate Category rows.
 *  - exact name+parent+level
 *  - case-insensitive name+parent+level
 *  - case-insensitive trim across whole table
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { Pool } from 'pg';

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const total = await pool.query(`SELECT COUNT(*)::int AS n FROM "Category"`);
  console.log(`Total Category rows: ${total.rows[0].n}`);

  console.log('\n--- Exact duplicates (same name + parent_id + level) ---');
  const exact = await pool.query(`
    SELECT name, parent_id, level, COUNT(*)::int AS cnt, array_agg(id ORDER BY id) AS ids
    FROM "Category"
    GROUP BY name, parent_id, level
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, name
    LIMIT 200
  `);
  console.log(`Exact duplicate groups: ${exact.rowCount}`);
  console.table(exact.rows.slice(0, 50));

  console.log('\n--- Case/whitespace-insensitive duplicates (same lower(trim(name)) + parent_id + level) ---');
  const ci = await pool.query(`
    SELECT LOWER(TRIM(name)) AS norm_name, parent_id, level,
           COUNT(*)::int AS cnt,
           array_agg(name ORDER BY id) AS variants,
           array_agg(id   ORDER BY id) AS ids
    FROM "Category"
    GROUP BY LOWER(TRIM(name)), parent_id, level
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, norm_name
    LIMIT 200
  `);
  console.log(`Case-insensitive duplicate groups: ${ci.rowCount}`);
  console.table(ci.rows.slice(0, 50));

  console.log('\n--- Same name across multiple parents (sub appears under several mains) ---');
  const xparent = await pool.query(`
    SELECT LOWER(TRIM(name)) AS norm_name, level,
           COUNT(DISTINCT parent_id)::int AS parent_count,
           COUNT(*)::int AS row_count
    FROM "Category"
    WHERE level >= 1
    GROUP BY LOWER(TRIM(name)), level
    HAVING COUNT(DISTINCT parent_id) > 1
    ORDER BY parent_count DESC, row_count DESC
    LIMIT 30
  `);
  console.log(`Names shared across parents: ${xparent.rowCount}`);
  console.table(xparent.rows.slice(0, 30));

  await pool.end();
})();
