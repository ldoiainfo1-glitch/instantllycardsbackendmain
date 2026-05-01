import prisma from "../utils/prisma";
import { Prisma } from "@prisma/client";
import { sendExpoPushNotification } from "../utils/push";
import { notify } from "../utils/notify";
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

interface CandidateEvent {
  id: number;
  title: string | null;
  date: Date;
  time: string | null;
}

function parseEventStart(eventDate: Date, eventTime: string | null): Date {
  const y = eventDate.getFullYear();
  const m = eventDate.getMonth();
  const d = eventDate.getDate();

  let hh = 0;
  let mm = 0;
  const t = String(eventTime ?? "").trim();

  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  const m12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m24) {
    hh = Math.min(23, Math.max(0, parseInt(m24[1], 10)));
    mm = Math.min(59, Math.max(0, parseInt(m24[2], 10)));
  } else if (m12) {
    let h = Math.min(12, Math.max(1, parseInt(m12[1], 10)));
    const meridian = m12[3].toUpperCase();
    if (h === 12) h = 0;
    hh = meridian === "PM" ? h + 12 : h;
    mm = Math.min(59, Math.max(0, parseInt(m12[2], 10)));
  }

  return new Date(y, m, d, hh, mm, 0, 0);
}

function inReminderWindow(args: {
  nowMs: number;
  eventStartMs: number;
  hoursOut: 24 | 2;
}): boolean {
  const targetMs = args.eventStartMs - args.hoursOut * 3600_000;
  return Math.abs(args.nowMs - targetMs) <= WINDOW_BEFORE_MS;
}

/**
 * Atomically claim every event eligible for the given reminder column.
 * Sets the column to NOW() and returns the rows that flipped from NULL.
 * Concurrent cron instances each get a disjoint subset (or nothing).
 */
async function claimEventForReminder(args: {
  column: "reminder_24h_sent_at" | "reminder_2h_sent_at";
  eventId: number;
}): Promise<ClaimedEvent | null> {
  const colSql =
    args.column === "reminder_24h_sent_at"
      ? Prisma.sql`"reminder_24h_sent_at"`
      : Prisma.sql`"reminder_2h_sent_at"`;

  const rows = await prisma.$queryRaw<ClaimedEvent[]>(
    Prisma.sql`UPDATE "Event"
               SET    ${colSql} = NOW()
               WHERE  "status" = 'active'
                 AND  "cancelled_at" IS NULL
                 AND  ${colSql} IS NULL
                 AND  "id" = ${args.eventId}
               RETURNING "id", "title"`,
  );
  return rows[0] ?? null;
}

async function fireReminders(args: {
  eventId: number;
  eventTitle: string;
  hoursOut: 24 | 2;
}): Promise<number> {
  // Pull active registrations only — skip refunded / fully-cancelled tickets.
  const regs = await prisma.eventRegistration.findMany({
    where: {
      event_id: args.eventId,
      cancelled_at: null,
      NOT: { refund_status: "refunded" },
    },
    select: {
      id: true,
      ticket_count: true,
      cancelled_count: true,
      user: { select: { id: true, push_token: true } },
    },
  });

  let sent = 0;
  for (const r of regs) {
    const activeTickets = (r.ticket_count ?? 0) - (r.cancelled_count ?? 0);
    if (activeTickets <= 0) continue;
    const token = r.user?.push_token;
    const userId = r.user?.id;
    try {
      const title = args.hoursOut === 24
        ? `Event starts in 24 hours: ${args.eventTitle}`
        : `Only 2 hours left: ${args.eventTitle}`;
      const body = args.hoursOut === 24
        ? `Reminder: Your event \"${args.eventTitle}\" will start in the next 24 hours.`
        : `Reminder: Only 2 hours left to start your event \"${args.eventTitle}\".`;
      await notify({
        pushToken: token,
        userId,
        title,
        body,
        type: args.hoursOut === 24 ? "event_reminder_24h" : "event_reminder_2h",
        data: { screen: "Events", eventId: args.eventId },
      });
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
  const nowMs = now.getTime();

  // Fetch a reasonable rolling window of active events and then evaluate
  // exact 24h/2h windows using date + time in application code.
  const candidates = await prisma.event.findMany({
    where: {
      status: "active",
      cancelled_at: null,
      date: {
        gte: new Date(nowMs - 24 * 3600_000),
        lte: new Date(nowMs + 3 * 24 * 3600_000),
      },
    },
    select: {
      id: true,
      title: true,
      date: true,
      time: true,
      reminder_24h_sent_at: true,
      reminder_2h_sent_at: true,
    },
  });

  let claimedCount = 0;
  for (const ev of candidates) {
    const start = parseEventStart(ev.date, ev.time);
    const startMs = start.getTime();
    if (Number.isNaN(startMs)) continue;

    if (!ev.reminder_24h_sent_at && inReminderWindow({ nowMs, eventStartMs: startMs, hoursOut: 24 })) {
      const claimed = await claimEventForReminder({
        column: "reminder_24h_sent_at",
        eventId: ev.id,
      });
      if (claimed) {
        claimedCount++;
        try {
          const sent = await fireReminders({
            eventId: ev.id,
            eventTitle: ev.title ?? "Event",
            hoursOut: 24,
          });
          logger.info("REMINDER_DISPATCHED", { eventId: ev.id, hoursOut: 24, sent });
        } catch (err) {
          logger.error("REMINDER_DISPATCH_ERROR", {
            eventId: ev.id,
            hoursOut: 24,
            err: String((err as any)?.message ?? err).slice(0, 200),
          });
        }
      }
    }

    if (!ev.reminder_2h_sent_at && inReminderWindow({ nowMs, eventStartMs: startMs, hoursOut: 2 })) {
      const claimed = await claimEventForReminder({
        column: "reminder_2h_sent_at",
        eventId: ev.id,
      });
      if (claimed) {
        claimedCount++;
        try {
          const sent = await fireReminders({
            eventId: ev.id,
            eventTitle: ev.title ?? "Event",
            hoursOut: 2,
          });
          logger.info("REMINDER_DISPATCHED", { eventId: ev.id, hoursOut: 2, sent });
        } catch (err) {
          logger.error("REMINDER_DISPATCH_ERROR", {
            eventId: ev.id,
            hoursOut: 2,
            err: String((err as any)?.message ?? err).slice(0, 200),
          });
        }
      }
    }
  }

  if (claimedCount === 0) {
    logger.debug("REMINDER_NO_EVENTS_IN_WINDOW", {});
  }
}
