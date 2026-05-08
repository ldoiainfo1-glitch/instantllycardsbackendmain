require("dotenv/config");
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(`
    SELECT id, title, voucher_image, voucher_banner, updated_at
    FROM "Voucher"
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 15
  `);
  for (const v of r.rows) {
    const img = v.voucher_image || "(null)";
    const ban = v.voucher_banner || "(null)";
    console.log(`#${v.id} ${v.title}`);
    console.log(`  IMG: ${String(img).slice(0, 120)}`);
    console.log(`  BAN: ${String(ban).slice(0, 120)}`);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
