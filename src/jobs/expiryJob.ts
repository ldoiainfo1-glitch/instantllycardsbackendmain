import prisma from '../utils/prisma';
import { logEvent } from '../utils/logger';

/**
 * Cancels expired premium promotions.
 * Run hourly via cron. Does NOT remove business role — that is permanent by design.
 *
 * BUSINESS RULE: The 'business' role is NEVER revoked on expiry.
 * Once granted through payment, a user remains a business user permanently.
 */
export async function cancelExpiredPromotions(): Promise<number> {
  const now = new Date();

  const result = await prisma.businessPromotion.updateMany({
    where: {
      status: 'active',
      plan_type: 'premium',
      expiry_date: { lt: now },
    },
    data: {
      status: 'expired',
      tier: 'free',
      visibility_priority_score: 10,  // Reset to free-tier score
    },
  });

  const count = result.count;
  if (count > 0) {
    logEvent('PROMOTION_EXPIRED_BATCH', { count, ranAt: now.toISOString() });
  }
  console.log(`[EXPIRY-JOB] ${count} expired promotions cancelled at ${now.toISOString()}`);
  return count;
}
