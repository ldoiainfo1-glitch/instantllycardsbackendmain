"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Role Assignment Script
 * Run ONCE to populate the UserRole table.
 *
 * Rules:
 *  - Default role = customer
 *  - User with any BusinessPromotion record → role = business
 *  - Legacy user with legacy_id = 68edfc0739b50dcdcacd3c5b → role = admin
 *
 * Usage: ts-node src/scripts/assignRoles.ts
 */
require("dotenv/config");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const ADMIN_LEGACY_ID = process.env.ADMIN_LEGACY_ID || '68edfc0739b50dcdcacd3c5b';
async function main() {
    console.log('🔑 Starting role assignment...');
    // Clear existing roles (safe to re-run)
    await prisma.userRole.deleteMany({});
    console.log('🗑  Cleared existing UserRole rows');
    // Fetch all users
    const users = await prisma.user.findMany({ select: { id: true, legacy_id: true } });
    console.log(`👥 Processing ${users.length} users...`);
    // Fetch user IDs that have at least one BusinessPromotion
    const promoUsers = await prisma.businessPromotion.findMany({
        select: { user_id: true },
        distinct: ['user_id'],
    });
    const businessUserIds = new Set(promoUsers.map((p) => p.user_id));
    console.log(`🏢 Found ${businessUserIds.size} business users`);
    // Find the admin user
    const adminUser = await prisma.user.findFirst({
        where: { legacy_id: ADMIN_LEGACY_ID },
    });
    let customerCount = 0;
    let businessCount = 0;
    let adminCount = 0;
    for (const user of users) {
        const isAdmin = adminUser && user.id === adminUser.id;
        const isBusiness = businessUserIds.has(user.id);
        if (isAdmin) {
            await prisma.userRole.create({ data: { user_id: user.id, role: 'admin' } });
            adminCount++;
        }
        else if (isBusiness) {
            await prisma.userRole.create({ data: { user_id: user.id, role: 'business' } });
            businessCount++;
        }
        else {
            await prisma.userRole.create({ data: { user_id: user.id, role: 'customer' } });
            customerCount++;
        }
    }
    console.log('✅ Role assignment complete:');
    console.log(`   admin:    ${adminCount}`);
    console.log(`   business: ${businessCount}`);
    console.log(`   customer: ${customerCount}`);
    console.log(`   total:    ${adminCount + businessCount + customerCount}`);
    await prisma.$disconnect();
    await pool.end();
}
main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
//# sourceMappingURL=assignRoles.js.map