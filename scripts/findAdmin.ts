import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: /supabase\.com|pooler\.supabase\.com|sslmode=require/i.test(databaseUrl)
    ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const admins = await prisma.$queryRawUnsafe<any[]>(`
    SELECT u.id, u.name, u.email, u.phone, ur.role, u.created_at
    FROM "User" u
    LEFT JOIN "UserRole" ur ON ur.user_id = u.id
    WHERE ur.role = 'admin'
       OR u.email ILIKE '%admin%'
    ORDER BY u.id
  `);
  console.log(`Admin users found: ${admins.length}\n`);
  admins.forEach((u) => {
    console.log(`#${u.id}  role=${u.role ?? '(none)'}  ${u.name ?? '-'}  ${u.email ?? '-'}  ${u.phone ?? '-'}`);
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
