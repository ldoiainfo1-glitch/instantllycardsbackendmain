import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { Role } from '@prisma/client';

async function seed() {
  console.log('🌱 Seeding demo users...');

  const demoUsers: Array<{
    phone: string;
    name: string;
    password: string;
    role: Role;
  }> = [
    {
      phone: '9000000001',
      name: 'Demo Customer',
      password: 'demo1234',
      role: Role.customer,
    },
    {
      phone: '9000000002',
      name: 'Demo Business',
      password: 'demo1234',
      role: Role.business,
    },
    {
      phone: '9000000003',
      name: 'Demo Admin',
      password: 'demo1234',
      role: Role.admin,
    },
  ];

  for (const demo of demoUsers) {
    try {
      // Check if user already exists
      const existing = await prisma.user.findFirst({
        where: { phone: demo.phone },
      });

      if (existing) {
        console.log(`✓ User already exists: ${demo.phone} (${demo.name})`);
        
        // Update role if needed
        const existingRole = await prisma.userRole.findFirst({
          where: { user_id: existing.id, role: demo.role },
        });
        
        if (!existingRole) {
          await prisma.userRole.create({
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
      const password_hash = await bcrypt.hash(demo.password, 10);
      const user = await prisma.user.create({
        data: {
          phone: demo.phone,
          name: demo.name,
          password_hash,
        },
      });

      // Assign role
      await prisma.userRole.create({
        data: {
          user_id: user.id,
          role: demo.role,
        },
      });

      console.log(`✓ Created user: ${demo.phone} (${demo.name}) - role: ${demo.role}`);
    } catch (error) {
      console.error(`✗ Failed to create user ${demo.phone}:`, error);
    }
  }

  console.log('🌱 Seeding complete!');
  await prisma.$disconnect();
}

seed();
