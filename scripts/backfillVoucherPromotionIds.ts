import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../src/utils/prisma';

type UnmatchedRow = {
  voucher_id: number;
  business_id: number | null;
  reason: string;
};

async function main() {
  const vouchers = await prisma.$queryRaw<Array<{ id: number; business_id: number | null }>>`
    SELECT id, business_id
    FROM "Voucher"
    WHERE business_promotion_id IS NULL
    ORDER BY id ASC
  `;

  let updated = 0;
  const unmatched: UnmatchedRow[] = [];

  for (const voucher of vouchers) {
    if (!voucher.business_id) {
      unmatched.push({
        voucher_id: voucher.id,
        business_id: null,
        reason: 'missing_business_id',
      });
      continue;
    }

    const promo = await prisma.businessPromotion.findFirst({
      where: { business_card_id: voucher.business_id },
      orderBy: { created_at: 'desc' },
      select: { id: true, business_name: true },
    });

    if (!promo) {
      unmatched.push({
        voucher_id: voucher.id,
        business_id: voucher.business_id,
        reason: 'no_matching_promotion',
      });
      continue;
    }

    await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        business_promotion_id: promo.id,
        business_name: promo.business_name,
      },
    });
    updated += 1;
  }

  const logDir = path.resolve(process.cwd(), 'migration_logs');
  await fs.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, 'voucher_business_promotion_unmatched.jsonl');

  if (unmatched.length > 0) {
    const content = unmatched.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await fs.writeFile(logFile, content, 'utf8');
  } else {
    await fs.writeFile(logFile, '', 'utf8');
  }

  console.log('[VOUCHER-BACKFILL] scanned:', vouchers.length);
  console.log('[VOUCHER-BACKFILL] updated:', updated);
  console.log('[VOUCHER-BACKFILL] unmatched:', unmatched.length);
  console.log('[VOUCHER-BACKFILL] unmatched_log:', logFile);
}

main()
  .catch((err) => {
    console.error('[VOUCHER-BACKFILL] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
