import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/client").DefaultArgs>;
export default prisma;
