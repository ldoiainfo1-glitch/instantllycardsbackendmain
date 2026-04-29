import prisma from "../utils/prisma";
import { Prisma } from "@prisma/client";
import { sendExpoPushNotification } from "../utils/push";
import { logger } from "../utils/logger";

/**
 * Phase 5 — Event reminder dispatcher.
 *
 * Runs from cron every 30 minutes (see scheduler.ts). For each active,
 * non-cancelled event:
 *   • If now is within ~30 min of (date - 24h) and reminder_24h_sent_at IS NULL
 *     → fire 24h reminders to all registered users → set reminder_24h_sent_at.
 *   • If now is within ~30 min of (date - 2h) and reminder_2h_sent_at IS NULL
 *     → fire 2h reminders.
 *
 * MULTI-INSTANCE SAFETY:
 *   We pre-claim each event with an atomic conditional UPDATE that flips
 *   reminder_*_sent_at from NULL → NOW() and RETURNs the row. Postgres
 *   serializes the UPDATE on the row's lock; only ONE cron instance can
 *   win per event per window. Losers get 0 rows back and skip silently.
 *   This is the canonical "claim before work" idempotency pattern and
 *   makes horizontal scaling safe.
 *
 * The dispatch window is 30 min wide so a 30-min cron cadence catches every
 * event exactly once. We use a generous lower bound (35 min before the
 * exact mark) so a slightly delayed cron tick still catches it.
 */

const WINDOW_BEFORE_MS = 35 * 60 * 1000; // catch ticks that ran a bit early

interface ClaimedEvent {
  id: number;
  title: string | null;
}

/**
 * Atomically claim every event eligible for the given reminder column.
 * Sets the column to NOW() and returns the rows that flipped from NULL.
 * Concurrent cron instances each get a disjoint subset (or nothing).
 */
async function claimEventsForReminder(args: {
  column: "reminder_24h_sent_at" | "reminder_2h_sent_at";
  windowLo: Date;
  windowHi: Date;
}): Promise<ClaimedEvent[]> {
  const colSql =
    args.column === "reminder_24h_sent_at"
      ? Prisma.sql`"reminder_24h_sent_at"`
      : Prisma.sql`"reminder_2h_sent_at"`;

  return prisma.$queryRaw<ClaimedEvent[]>(
    Prisma.sql`UPDATE "Event"
               SET    ${colSql} = NOW()
               WHERE  "status" = 'active'
                 AND  "cancelled_at" IS NULL
                 AND  ${colSql} IS NULL
                 AND  "date" >= ${args.windowLo}
                 AND  "date" <= ${args.windowHi}
               RETURNING "id", "title"`,
  );
}

async function fireReminders(args: {
  eventId: number;
  hoursOut: 24 | 2;
}): Promise<number> {
  // Pull active registrations only — skip refunded / cancelled.
  const regs = await prisma.eventRegistration.findMany({
    where: {
      event_id: args.eventId,
      cancelled_at: null,
      OR: [{ refund_status: null }, { refund_status: "failed" }],
    },
    select: {
      id: true,
      user: { select: { id: true, push_token: true } },
    },
  });

  let sent = 0;
  for (const r of regs) {
    const token = r.user?.push_token;
    if (!token) continue;
    try {
      sendExpoPushNotification(
        token,
        args.hoursOut === 24
          ? "Event tomorrow!"
          : "Event starts in 2 hours",
        args.hoursOut === 24
          ? "Your event is tomorrow. Get ready!"
          : "Your event starts soon. See you there!",
        { screen: "Events", eventId: args.eventId },
      );
      sent++;
    } catch (err) {
      logger.error("REMINDER_PUSH_FAILED", {
        eventId: args.eventId,
        registrationId: r.id,
        err: String((err as any)?.message ?? err).slice(0, 200),
      });
    }
  }
  return sent;
}

export async function dispatchEventReminders(): Promise<void> {
  const now = new Date();
  const lo24 = new Date(now.getTime() + 24 * 3600_000 - WINDOW_BEFORE_MS);
  const hi24 = new Date(now.getTime() + 24 * 3600_000 + WINDOW_BEFORE_MS);
  const lo2  = new Date(now.getTime() + 2  * 3600_000 - WINDOW_BEFORE_MS);
  const hi2  = new Date(now.getTime() + 2  * 3600_000 + WINDOW_BEFORE_MS);

  // ── 24h reminders: claim → dispatch
  const claimed24 = await claimEventsForReminder({
    column: "reminder_24h_sent_at",
    windowLo: lo24,
    windowHi: hi24,
  });
  for (const ev of claimed24) {
    try {
      const sent = await fireReminders({ eventId: ev.id, hoursOut: 24 });
      logger.info("REMINDER_DISPATCHED", { eventId: ev.id, hoursOut: 24, sent });
    } catch (err) {
      // Already claimed; we cannot un-claim safely (would double-send next
      // tick). Log and let ops re-run manually if needed.
      logger.error("REMINDER_DISPATCH_ERROR", {
        eventId: ev.id,
        hoursOut: 24,
        err: String((err as any)?.message ?? err).slice(0, 200),
      });
    }
  }

  // ── 2h reminders
  const claimed2 = await claimEventsForReminder({
    column: "reminder_2h_sent_at",
    windowLo: lo2,
    windowHi: hi2,
  });
  for (const ev of claimed2) {
    try {
      const sent = await fireReminders({ eventId: ev.id, hoursOut: 2 });
      logger.info("REMINDER_DISPATCHED", { eventId: ev.id, hoursOut: 2, sent });
    } catch (err) {
      logger.error("REMINDER_DISPATCH_ERROR", {
        eventId: ev.id,
        hoursOut: 2,
        err: String((err as any)?.message ?? err).slice(0, 200),
      });
    }
  }

  if (claimed24.length === 0 && claimed2.length === 0) {
    logger.debug("REMINDER_NO_EVENTS_IN_WINDOW", {});
  }
}
