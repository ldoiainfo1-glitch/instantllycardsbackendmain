require("dotenv/config");
const { Client } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

const tables = [
  "User",
  "Profile",
  "UserRole",
  "Category",
  "BusinessCard",
  "BusinessPromotion",
  "Review",
  "Voucher",
  "VoucherClaim",
  "VoucherTransfer",
  "VoucherRedemption",
  "VoucherTransferLog",
  "Contact",
  "Notification",
  "Message",
  "Chat",
  "Group",
  "GroupMember",
  "GroupSession",
  "CardShare",
  "SharedCard",
  "GroupSharedCard",
  "Ad",
  "AdImpression",
  "AdClick",
  "Feedback",
  "Enquiry"
];

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  const results = [];
  for (const t of tables) {
    try {
      const res = await client.query(`SELECT COUNT(*)::bigint AS count FROM "${t}"`);
      results.push([t, res.rows[0].count]);
    } catch (e) {
      results.push([t, `ERR`]);
    }
  }
  await client.end();

  const pad = (s, n) => String(s).padEnd(n);
  const max = results.reduce((a, [k]) => Math.max(a, String(k).length), 0);
  console.log("Counts by table:");
  for (const [k, v] of results) {
    console.log(pad(k, max + 2) + v);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
