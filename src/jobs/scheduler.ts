import cron from 'node-cron';
import { cancelExpiredPromotions } from './expiryJob';

/**
 * Registers all scheduled jobs.
 * Call once from index.ts after server starts.
 */
export function startScheduledJobs(): void {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    try {
      await cancelExpiredPromotions();
    } catch (err) {
      console.error('[CRON] Expiry job failed:', err);
    }
  });

  console.log('[CRON] Scheduled jobs registered (expiry: every hour)');
}
