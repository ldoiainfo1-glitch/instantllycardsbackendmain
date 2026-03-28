require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const models = [
  "user",
  "profile",
  "userRole",
  "category",
  "businessCard",
  "businessPromotion",
  "review",
  "voucher",
  "voucherClaim",
  "voucherTransfer",
  "voucherRedemption",
  "voucherTransferLog",
  "contact",
  "notification",
  "message",
  "chat",
  "group",
  "groupMember",
  "groupSession",
  "cardShare",
  "sharedCard",
  "groupSharedCard",
  "ad",
  "adImpression",
  "adClick",
  "feedback",
  "enquiry"
];

(async () => {
  const results = [];
  const errors = [];
  for (const m of models) {
    const client = prisma[m];
    if (!client || typeof client.count !== "function") {
      results.push([m, "N/A"]);
      continue;
    }
    try {
      const c = await client.count();
      results.push([m, c]);
    } catch (e) {
      results.push([m, "ERR"]);
      const msg = e && e.message ? e.message : String(e);
      errors.push([m, msg]);
    }
  }
  await prisma.$disconnect();

  const pad = (s, n) => String(s).padEnd(n);
  const max = results.reduce((a, [k]) => Math.max(a, String(k).length), 0);
  console.log("Counts by table:");
  for (const [k, v] of results) {
    console.log(pad(k, max + 2) + v);
  }
  if (errors.length) {
    console.log("\nErrors:");
    for (const [k, msg] of errors) {
      console.log(pad(k, max + 2) + msg);
    }
  }
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
