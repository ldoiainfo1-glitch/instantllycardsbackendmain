import { Response } from "express";
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { paramInt } from "../utils/params";
import { getIO } from "../services/socketService";
import { sendExpoPushNotification } from "../utils/push";
import { logger } from "../utils/logger";

/**
 * Phase 4 — Waitlist
 *
 * Routes:
 *   POST /events/:id/waitlist           — join (user)
 *   POST /events/:id/waitlist/promote   — manual promote next (organizer/admin)
 *
 * Schema: EventWaitlist (added in Phase 1 migration). Has
 *   @@unique([event_id, user_id]) and @@index([event_id, status, position]).
 *
 * Atomic promotion strategy:
 *   A single Postgres CTE / sub-select using `FOR UPDATE SKIP LOCKED`
 *   ensures two concurrent promote calls cannot grab the same waitlist
 *   row, so we never double-promote. The capacity increment on
 *   "Event" then uses the same conditional UPDATE pattern as Phase 3 to
 *   prevent overbooking. All work happens inside one $transaction.
 *
 * Backward compatibility:
 *   • Existing register flow is untouched.
 *   • Waitlist endpoints are NEW — opt-in by client.
 *   • Events without a max_attendees cap are NOT eligible for waitlist
 *     (they can never be "full") → 400.
 */

// ─── Internal helpers ────────────────────────────────────────────────

interface PromotedRow {
  id: number;
  user_id: number;
  ticket_count: number;
}

interface PromotionResult {
  promoted_user_id: number;
  new_registration_id: number;
  waitlist_id: number;
  qr_code: string;
}

/**
 * Atomically promote the next waiting user for `eventId`.
 *
 * Returns null when:
 *   • waitlist is empty,
 *   • event is inactive / cancelled,
 *   • event has no remaining capacity,
 *   • the next waitlisted user is already registered (that row is marked
 *     'cancelled' and we move on — caller may re-invoke to try the next one).
 *
 * Throws on unexpected DB errors. Safe to call concurrently — Postgres
 * SKIP LOCKED + the conditional event UPDATE serialize the critical section.
 *
 * Exported so future cancel / refund / admin-removal flows can reuse it.
 */
export async function promoteNextFromWaitlist(
  eventId: number,
): Promise<PromotionResult | null> {
  return prisma.$transaction(async (tx) => {
    // 1. Re-check event is promotion-eligible.
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        status: true,
        cancelled_at: true,
        max_attendees: true,
        attendee_count: true,
      },
    });
    if (!event) return null;
    if (event.status !== "active" || event.cancelled_at) return null;

    // 2. Pick + lock the next waiting row in one statement.
    //    SKIP LOCKED → concurrent promote calls each get a different row.
    const promoted = await tx.$queryRaw<PromotedRow[]>(
      Prisma.sql`UPDATE "EventWaitlist"
                 SET    "status"      = 'promoted',
                        "promoted_at" = NOW()
                 WHERE  "id" = (
                   SELECT "id"
                   FROM   "EventWaitlist"
                   WHERE  "event_id" = ${eventId}
                     AND  "status"   = 'waiting'
                   ORDER  BY "position" ASC, "id" ASC
                   LIMIT  1
                   FOR    UPDATE SKIP LOCKED
                 )
                 RETURNING "id", "user_id", "ticket_count"`,
    );
    if (promoted.length === 0) return null; // waitlist empty

    const row = promoted[0];
    const count = Math.max(1, row.ticket_count | 0);

    // 3. Skip if user is already registered. Mark the row 'cancelled'
    //    so we don't keep picking it on retries.
    const existing = await tx.eventRegistration.findFirst({
      where: { event_id: eventId, user_id: row.user_id },
      select: { id: true },
    });
    if (existing) {
      await tx.eventWaitlist.update({
        where: { id: row.id },
        data: { status: "cancelled" },
      });
      return null;
    }

    // 4. Atomic event capacity increment. If full → roll back the whole tx
    //    (the waitlist row reverts to 'waiting').
    const eventRows: number = await tx.$executeRaw(
      Prisma.sql`UPDATE "Event"
                 SET    "attendee_count" = "attendee_count" + ${count}
                 WHERE  "id" = ${eventId}
                   AND  "status" = 'active'
                   AND  "cancelled_at" IS NULL
                   AND  ("max_attendees" IS NULL
                         OR "attendee_count" + ${count} <= "max_attendees")`,
    );
    if (eventRows === 0) {
      const err: any = new Error("Event capacity reached");
      err.http = 409;
      err.code = "EVENT_FULL";
      throw err; // rolls back the 'promoted' UPDATE above
    }

    // 5. Create the registration (waitlist promotion is currently treated as
    //    a free pass-through; payment-on-promotion is a future phase).
    const qrCode = `EVT-${eventId}-${crypto.randomBytes(6).toString("hex")}`;
    let regId: number;
    try {
      const reg = await tx.eventRegistration.create({
        data: {
          event_id: eventId,
          user_id: row.user_id,
          ticket_tier_id: null,
          ticket_count: count,
          qr_code: qrCode,
          payment_status: "not_required",
          payment_order_id: null,
          payment_id: null,
          payment_signature: null,
          amount_paid: null,
        },
      });
      regId = reg.id;
    } catch (e: any) {
      // P2002 → unique (user_id, event_id) — concurrent register slipped in
      if (e?.code === "P2002") {
        await tx.eventWaitlist.update({
          where: { id: row.id },
          data: { status: "cancelled" },
        });
        const err: any = new Error("User already registered");
        err.http = 409;
        err.code = "DUPLICATE_REGISTRATION";
        throw err;
      }
      throw e;
    }

    return {
      promoted_user_id: row.user_id,
      new_registration_id: regId,
      waitlist_id: row.id,
      qr_code: qrCode,
    };
  });
}

/**
 * Retry wrapper around `promoteNextFromWaitlist`.
 *
 * `promoteNextFromWaitlist` returns null when the picked candidate is
 * already-registered (it marks that row 'cancelled' and exits). To find
 * the FIRST eligible candidate, we loop — but with a hard ceiling so a
 * pathological run of bad rows can never cause an unbounded loop.
 *
 * - Stops on first success → returns PromotionResult.
 * - Stops on EVENT_FULL / DUPLICATE_REGISTRATION → re-throws (terminal).
 * - Stops after `maxAttempts` with no eligible candidate → returns null.
 *
 * Exported for future cancel/refund handlers.
 */
export async function promoteNextEligible(
  eventId: number,
  maxAttempts = 10,
): Promise<PromotionResult | null> {
  for (let i = 0; i < maxAttempts; i++) {
    let result: PromotionResult | null;
    try {
      result = await promoteNextFromWaitlist(eventId);
    } catch (err: any) {
      // Terminal conditions — propagate to caller.
      if (err?.http === 409) {
        logger.warn("WAITLIST_PROMOTION_TERMINAL", {
          eventId,
          attempt: i + 1,
          code: err.code,
        });
        throw err;
      }
      throw err;
    }
    if (result) {
      logger.info("WAITLIST_PROMOTED", {
        eventId,
        attempt: i + 1,
        userId: result.promoted_user_id,
        registrationId: result.new_registration_id,
      });
      return result;
    }
    logger.debug("WAITLIST_PROMOTION_SKIPPED", {
      eventId,
      attempt: i + 1,
      reason: "no_eligible_or_duplicate",
    });
  }
  logger.warn("WAITLIST_PROMOTION_EXHAUSTED", { eventId, maxAttempts });
  return null;
}

// ─── Route: POST /events/:id/waitlist ────────────────────────────────

export async function joinWaitlist(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const userId = req.user!.userId;

  // Ticket count: optional, defaults to 1, must be a positive integer ≤ 100.
  let ticketCount = 1;
  if (req.body?.ticket_count !== undefined && req.body?.ticket_count !== null) {
    const raw =
      typeof req.body.ticket_count === "number"
        ? req.body.ticket_count
        : parseInt(String(req.body.ticket_count), 10);
    if (
      !Number.isFinite(raw) ||
      !Number.isInteger(raw) ||
      raw <= 0 ||
      raw > 100
    ) {
      res.status(400).json({ error: "Invalid ticket_count" });
      return;
    }
    ticketCount = raw;
  }

  console.log(
    "[joinWaitlist] eventId:",
    eventId,
    "userId:",
    userId,
    "count:",
    ticketCount,
  );

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      status: true,
      cancelled_at: true,
      max_attendees: true,
      attendee_count: true,
    },
  });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (event.status !== "active" || event.cancelled_at) {
    res.status(400).json({ error: "Event is not active" });
    return;
  }
  if (event.max_attendees === null) {
    res.status(400).json({
      error: "This event has no capacity limit; register directly",
      code: "NO_CAPACITY_CAP",
    });
    return;
  }
  // Hard rule: only allow waitlist when event is full.
  if (event.attendee_count < event.max_attendees) {
    res.status(400).json({
      error: "Event has available seats; register directly",
      code: "EVENT_NOT_FULL",
    });
    return;
  }

  // User must not already be registered.
  const existingReg = await prisma.eventRegistration.findFirst({
    where: { event_id: eventId, user_id: userId },
    select: { id: true },
  });
  if (existingReg) {
    res
      .status(409)
      .json({ error: "User already registered for this event" });
    return;
  }

  // Insert with auto-assigned position via raw SQL to avoid a read-then-write
  // race on MAX(position). The @@unique([event_id, user_id]) guards duplicates.
  try {
    const inserted = await prisma.$queryRaw<
      Array<{ id: number; position: number; status: string }>
    >(
      Prisma.sql`INSERT INTO "EventWaitlist"
                 ("event_id", "user_id", "ticket_count", "position", "status", "created_at")
                 VALUES (
                   ${eventId},
                   ${userId},
                   ${ticketCount},
                   COALESCE(
                     (SELECT MAX("position") FROM "EventWaitlist" WHERE "event_id" = ${eventId}),
                     0
                   ) + 1,
                   'waiting',
                   NOW()
                 )
                 RETURNING "id", "position", "status"`,
    );
    const row = inserted[0];
    console.log(
      "[joinWaitlist] SUCCESS — waitlistId:",
      row.id,
      "position:",
      row.position,
    );
    res.status(201).json({
      waitlist: {
        id: row.id,
        event_id: eventId,
        user_id: userId,
        ticket_count: ticketCount,
        position: row.position,
        status: row.status,
      },
      position: row.position,
    });
  } catch (e: any) {
    // Unique violation → already on waitlist
    if (
      e?.code === "P2002" ||
      String(e?.message ?? "").includes("EventWaitlist_event_id_user_id_key") ||
      String(e?.meta?.code ?? "") === "23505"
    ) {
      res.status(409).json({ error: "Already on waitlist" });
      return;
    }
    console.error("[joinWaitlist] ERROR:", e);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ─── Route: POST /events/:id/waitlist/promote (organizer / admin) ────

export async function promoteWaitlist(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);

  // Authorization: must be event organizer (via business_promotion or
  // business) or admin.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      business_promotion: { select: { user_id: true } },
      business: { select: { user_id: true } },
    },
  });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const ownerId =
    event.business_promotion?.user_id ?? event.business?.user_id ?? null;
  const isAdmin = !!req.user?.roles?.includes("admin");
  if (!isAdmin && (ownerId === null || ownerId !== req.user?.userId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (event.status !== "active" || event.cancelled_at) {
    res.status(400).json({ error: "Event is not active" });
    return;
  }

  console.log(
    "[promoteWaitlist] eventId:",
    eventId,
    "by:",
    req.user!.userId,
  );

  let result: PromotionResult | null;
  try {
    result = await promoteNextEligible(eventId, 10);
  } catch (err: any) {
    if (err?.http === 409) {
      console.log("[promoteWaitlist] tx-reject:", err.code);
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[promoteWaitlist] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!result) {
    res.status(200).json({
      promoted_user_id: null,
      new_registration_id: null,
      message: "No eligible waitlist entries",
    });
    return;
  }

  console.log(
    "[promoteWaitlist] SUCCESS — promotedUserId:",
    result.promoted_user_id,
    "regId:",
    result.new_registration_id,
  );

  // Notify the promoted user (best-effort, non-blocking)
  try {
    const promotedUser = await prisma.user.findUnique({
      where: { id: result.promoted_user_id },
      select: { id: true, push_token: true },
    });
    const io = getIO();
    const payload = {
      type: "event:waitlist_promoted",
      eventId,
      eventTitle: event.title,
      registrationId: result.new_registration_id,
      qrCode: result.qr_code,
    };
    if (io) io.to(`user:${result.promoted_user_id}`).emit(
      "event:waitlist_promoted",
      payload,
    );
    if (promotedUser?.push_token) {
      sendExpoPushNotification(
        promotedUser.push_token,
        "You're in!",
        `A seat opened up for "${event.title}". You've been promoted from the waitlist.`,
        { screen: "Events" },
      );
    }
  } catch {
    /* non-blocking */
  }

  res.status(201).json({
    promoted_user_id: result.promoted_user_id,
    new_registration_id: result.new_registration_id,
  });
}
