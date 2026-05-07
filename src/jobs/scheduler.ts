import cron from "node-cron";
import { cancelExpiredPromotions } from "./expiryJob";
import { checkPushReceipts } from "../utils/push";
import { dispatchEventReminders } from "./eventReminderJob";
import { processInstallmentDeadlines } from "./installmentJob";

/**
 * Registers all scheduled jobs.
 * Call once from index.ts after server starts.
 */
export function startScheduledJobs(): void {
  // Run every hour at minute 0
  cron.schedule("0 * * * *", async () => {
    try {
      await cancelExpiredPromotions();
    } catch (err) {
      console.error("[CRON] Expiry job failed:", err);
    }
  });

  // Check Expo push receipts every 30 minutes — clears DeviceNotRegistered stale tokens.
  cron.schedule("*/30 * * * *", async () => {
    try {
      await checkPushReceipts();
    } catch (err) {
      console.error("[CRON] Push receipt check failed:", err);
    }
  });

  // Phase 5 — Event reminders every 30 minutes (24h + 2h windows).
  cron.schedule("*/30 * * * *", async () => {
    try {
      await dispatchEventReminders();
    } catch (err) {
      console.error("[CRON] Event reminder job failed:", err);
    }
  });

  // Installment deadlines — hourly: send 3-day reminders + auto-expire overdue claims.
  cron.schedule("15 * * * *", async () => {
    try {
      await processInstallmentDeadlines();
    } catch (err) {
      console.error("[CRON] Installment deadline job failed:", err);
    }
  });

  console.log(
    "[CRON] Scheduled jobs registered (expiry: every hour | push receipts: every 30 min | event reminders: every 30 min | installments: every hour)",
  );
}
