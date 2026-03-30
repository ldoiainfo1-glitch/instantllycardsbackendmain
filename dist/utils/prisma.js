"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
require("dotenv/config");
const databaseUrl = (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL) ||
    process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
}
const needsSsl = /supabase\.com|pooler\.supabase\.com/i.test(databaseUrl) ||
    /sslmode=require/i.test(databaseUrl);
const pool = new pg_1.Pool({
    connectionString: databaseUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
exports.default = prisma;
//# sourceMappingURL=prisma.js.map