import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { Pool } from 'pg';

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const r = await pool.query(
    'SELECT city, COUNT(*) FROM "BusinessPromotion" WHERE user_id=754 GROUP BY city ORDER BY 2 DESC'
  );
  console.table(r.rows);
  await pool.end();
})();
