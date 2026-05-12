import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const TARGET_USER_ID = 754;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const dbUrl: string = databaseUrl;
const needsSsl = /supabase\.com|pooler\.supabase\.com/i.test(dbUrl) || /sslmode=require/i.test(dbUrl);
const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log(`Database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Inspecting user_id = ${TARGET_USER_ID}\n`);

  const user = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, email, phone, created_at FROM "User" WHERE id = $1`,
    TARGET_USER_ID
  );
  if (user.length === 0) {
    console.log(`User #${TARGET_USER_ID} not found.`);
    return;
  }
  console.log('User row:', user[0], '\n');

  // Discover all tables with a user_id column referencing User
  const fks = await prisma.$queryRawUnsafe<any[]>(`
    SELECT DISTINCT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'User'
      AND ccu.column_name = 'id'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `);
  console.log(`FK columns referencing User.id: ${fks.length}\n`);

  let totalRows = 0;
  for (const fk of fks) {
    try {
      const c = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::int AS n FROM "${fk.table_name}" WHERE "${fk.column_name}" = $1`,
        TARGET_USER_ID
      );
      const n = c[0].n;
      if (n > 0) {
        console.log(`  ${fk.table_name}.${fk.column_name.padEnd(25)} -> ${n}`);
        totalRows += n;
      }
    } catch (e: any) {
      console.log(`  ${fk.table_name}.${fk.column_name} -> ERROR: ${e.message}`);
    }
  }
  console.log(`\nTotal related rows: ${totalRows}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
