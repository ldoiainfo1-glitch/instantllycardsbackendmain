// Backward-compat shim. Use `src/utils/prisma.ts` directly in new code.
// Re-exporting keeps a single shared Pool + PrismaClient across the app,
// preventing duplicate connection pools that exhaust Supabase pooler limits.
import prisma from './utils/prisma';
export default prisma;

