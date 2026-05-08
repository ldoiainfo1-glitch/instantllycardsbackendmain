require("dotenv/config");
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await c.connect();
  const r1 = await c.query(`UPDATE "Voucher" SET voucher_image = NULL WHERE voucher_image IS NOT NULL AND voucher_image NOT LIKE 'http%' RETURNING id`);
  const r2 = await c.query(`UPDATE "Voucher" SET voucher_banner = NULL WHERE voucher_banner IS NOT NULL AND voucher_banner NOT LIKE 'http%' RETURNING id`);
  console.log("Cleared voucher_image on IDs:", r1.rows.map(x => x.id));
  console.log("Cleared voucher_banner on IDs:", r2.rows.map(x => x.id));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
