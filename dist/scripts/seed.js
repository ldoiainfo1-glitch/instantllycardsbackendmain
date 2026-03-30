"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const client_1 = require("@prisma/client");
async function seed() {
    console.log('🌱 Seeding demo users...');
    const demoUsers = [
        {
            phone: '9000000001',
            name: 'Demo Customer',
            password: 'demo1234',
            role: client_1.Role.customer,
        },
        {
            phone: '9000000002',
            name: 'Demo Business',
            password: 'demo1234',
            role: client_1.Role.business,
        },
        {
            phone: '9000000003',
            name: 'Demo Admin',
            password: 'demo1234',
            role: client_1.Role.admin,
        },
    ];
    for (const demo of demoUsers) {
        try {
            // Check if user already exists
            const existing = await prisma_1.default.user.findFirst({
                where: { phone: demo.phone },
            });
            if (existing) {
                console.log(`✓ User already exists: ${demo.phone} (${demo.name})`);
                // Update role if needed
                const existingRole = await prisma_1.default.userRole.findFirst({
                    where: { user_id: existing.id, role: demo.role },
                });
                if (!existingRole) {
                    await prisma_1.default.userRole.create({
                        data: {
                            user_id: existing.id,
                            role: demo.role,
                        },
                    });
                    console.log(`  → Added ${demo.role} role to existing user`);
                }
                continue;
            }
            // Create user
            const password_hash = await bcryptjs_1.default.hash(demo.password, 10);
            const user = await prisma_1.default.user.create({
                data: {
                    phone: demo.phone,
                    name: demo.name,
                    password_hash,
                },
            });
            // Assign role
            await prisma_1.default.userRole.create({
                data: {
                    user_id: user.id,
                    role: demo.role,
                },
            });
            console.log(`✓ Created user: ${demo.phone} (${demo.name}) - role: ${demo.role}`);
        }
        catch (error) {
            console.error(`✗ Failed to create user ${demo.phone}:`, error);
        }
    }
    console.log('🌱 Seeding complete!');
    await prisma_1.default.$disconnect();
}
seed();
//# sourceMappingURL=seed.js.map