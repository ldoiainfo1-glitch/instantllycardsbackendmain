import { Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { paramInt } from "../utils/params";
import { refundRazorpayPayment } from "../services/razorpayService";
import { promoteNextEligible } from "./waitlistController";
import { getIO } from "../services/socketService";
import { sendExpoPushNotification } from "../utils/push";
import { logger } from "../utils/logger";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Phase 5 — Refund + Event-cancel.
 *
 * Routes:
 *   POST /events/:id/cancel              — organizer/admin: cancels event + bulk refund
 *   POST /events/:id/refund              — organizer/admin: refund a single registration (full)
 *   POST /events/:id/partial-cancel      — authenticated user: partially cancel N tickets from their own registration
 *
 * Flow guarantees:
 *   • Razorpay refund called BEFORE DB mutation. If Razorpay fails we leave
 *     the row untouched and return 502.
 *   • Capacity rollback (event + tier) inside a transaction with
 *     GREATEST(0, …) so concurrent webhook+manual paths can't go negative.
 *   • Refund + capacity rollback are idempotent — re-running on a row that
 *     is already refund_status="refunded" is a no-op.
 *   • Waitlist promotion is best-effort, OUTSIDE the tx, with retry cap.
 */

async function loadEventForOwnerCheck(eventId: number) {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: {
      business_promotion: { select: { user_id: true } },
      business: { select: { user_id: true } },
    },
  });
}

function isOwnerOrAdmin(
  event: { business_promotion?: { user_id: number } | null; business?: { user_id: number } | null } | null,
  req: AuthRequest,
): boolean {
  if (!event) return false;
  if (req.user?.roles?.includes("admin")) return true;
  const ownerId =
    event.business_promotion?.user_id ?? event.business?.user_id ?? null;
  return ownerId !== null && ownerId === req.user?.userId;
}

/**
 * Internal: refund a single registration, roll back capacity, mark refunded.
 * Returns { ok, alreadyRefunded, refundId } — or throws on Razorpay error.
 *
 * Caller is responsible for waitlist promotion (we don't do it here so the
 * bulk-cancel path can do a single sweep at the end).
 */
async function refundRegistrationInternal(args: {
  registrationId: number;
  reason?: string;
}): Promise<{ ok: true; alreadyRefunded: boolean; refundId: string | null }> {
  const reg = await prisma.eventRegistration.findUnique({
    where: { id: args.registrationId },
    select: {
      id: true,
      event_id: true,
      user_id: true,
      ticket_count: true,
      ticket_tier_id: true,
      payment_id: true,
      payment_status: true,
      amount_paid: true,
      refund_status: true,
    },
  });
  if (!reg) {
    const err: any = new Error("Registration not found");
    err.http = 404;
    throw err;
  }
  if (reg.refund_status === "refunded") {
    return { ok: true, alreadyRefunded: true, refundId: null };
  }

  let refundId: string | null = null;
  let refundAmount: number | null = null;

  // Only call Razorpay for actually-paid registrations.
  if (reg.payment_status === "paid" && reg.payment_id) {
    // Mark "processing" first so concurrent calls don't double-refund.
    // We use a conditional UPDATE so only one caller wins the race.
    const claimed: number = await prisma.$executeRaw(
      Prisma.sql`UPDATE "EventRegistration"
                 SET "refund_status" = 'processing'
                 WHERE "id" = ${reg.id}
                   AND ("refund_status" IS NULL OR "refund_status" = 'failed' OR "refund_status" = 'partial_refund')`,
    );
    if (claimed === 0) {
      // Someone else is already processing/refunded. Treat as no-op.
      return { ok: true, alreadyRefunded: true, refundId: null };
    }

    try {
      const refund = await refundRazorpayPayment({
        paymentId: reg.payment_id,
        amountPaise:
          reg.amount_paid !== null
            ? Math.round(reg.amount_paid * 100)
            : undefined,
        notes: { reason: args.reason ?? "Event cancellation / refund" },
      });
      refundId = refund.id;
      refundAmount = refund.amount / 100;
    } catch (err: any) {
      console.error(
        "[refund] razorpay ERROR — regId:",
        reg.id,
        err?.message ?? err,
      );
      // Roll back the 'processing' claim
      await prisma.eventRegistration.update({
        where: { id: reg.id },
        data: { refund_status: "failed" },
      });
      const e: any = new Error("Refund failed at provider");
      e.http = 502;
      e.code = "REFUND_PROVIDER_FAILED";
      throw e;
    }
  }
  // Free / unpaid registrations: no Razorpay call, just rollback + mark.

  // Atomic DB rollback
  await prisma.$transaction(async (tx) => {
    await tx.eventRegistration.update({
      where: { id: reg.id },
      data: {
        refund_status: "refunded",
        refund_id: refundId,
        refund_amount: refundAmount ?? reg.amount_paid ?? null,
        cancelled_at: new Date(),
        payment_status: reg.payment_status === "paid" ? "refunded" : reg.payment_status,
      },
    });
    await tx.$executeRaw(
      Prisma.sql`UPDATE "Event"
                 SET "attendee_count" = GREATEST(0, "attendee_count" - ${reg.ticket_count})
                 WHERE "id" = ${reg.event_id}`,
    );
    if (reg.ticket_tier_id) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE "EventTicketTier"
                   SET "quantity_sold" = GREATEST(0, "quantity_sold" - ${reg.ticket_count}),
                       "updated_at"    = NOW()
                   WHERE "id" = ${reg.ticket_tier_id}`,
      );
    }
  });

  console.log(
    "[refund] regId:",
    reg.id,
    "refunded; refundId:",
    refundId,
    "capacity rolled back",
  );

  // Best-effort notify the user
  try {
    const user = await prisma.user.findUnique({
      where: { id: reg.user_id },
      select: { id: true, push_token: true },
    });
    const io = getIO();
    if (io) io.to(`user:${reg.user_id}`).emit("event:refunded", {
      type: "event:refunded",
      registrationId: reg.id,
      eventId: reg.event_id,
      refundId,
    });
    if (user?.push_token) {
      sendExpoPushNotification(
        user.push_token,
        "Refund initiated",
        "Your event registration has been refunded.",
        { screen: "Events" },
      );
    }
  } catch {/* non-blocking */}

  return { ok: true, alreadyRefunded: false, refundId };
}

// ─── Route: POST /events/:id/refund ──────────────────────────────────

export async function refundRegistration(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const registrationId = parseInt(String(req.body?.registration_id ?? ""), 10);
  if (!Number.isFinite(registrationId) || registrationId <= 0) {
    res.status(400).json({ error: "registration_id is required" });
    return;
  }

  const event = await loadEventForOwnerCheck(eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!isOwnerOrAdmin(event, req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const reg = await prisma.eventRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, event_id: true },
  });
  if (!reg || reg.event_id !== eventId) {
    res.status(404).json({ error: "Registration not found for this event" });
    return;
  }

  console.log(
    "[refundRegistration] eventId:",
    eventId,
    "regId:",
    registrationId,
    "by:",
    req.user!.userId,
  );

  try {
    const result = await refundRegistrationInternal({
      registrationId,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
    });
    // SAFETY NOTE: refundRegistrationInternal already committed its DB tx
    // (capacity rollback) before we get here, so promoteNextEligible reads
    // fresh attendee_count. Order matters — do NOT invert.
    try {
      await promoteNextEligible(eventId, 10);
    } catch (e: any) {
      logger.warn("WAITLIST_PROMOTION_SKIPPED", {
        eventId,
        registrationId,
        code: e?.code,
        err: String(e?.message ?? e).slice(0, 200),
      });
    }
    res.json({
      registration_id: registrationId,
      refund_id: result.refundId,
      already_refunded: result.alreadyRefunded,
      refund_status: "refunded",
    });
  } catch (err: any) {
    if (err?.http) {
      res.status(err.http).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[refundRegistration] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ─── Route: POST /events/:id/cancel ──────────────────────────────────

export async function cancelEvent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;

  const event = await loadEventForOwnerCheck(eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!isOwnerOrAdmin(event, req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (event.cancelled_at) {
    res.status(409).json({
      error: "Event already cancelled",
      cancelled_at: event.cancelled_at,
    });
    return;
  }

  console.log(
    "[cancelEvent] eventId:",
    eventId,
    "by:",
    req.user!.userId,
    "reason:",
    reason,
  );

  // 1. Mark event cancelled FIRST so no new registrations / promotions can
  //    succeed (the conditional UPDATEs in register & promote check this).
  await prisma.event.update({
    where: { id: eventId },
    data: {
      cancelled_at: new Date(),
      cancellation_reason: reason,
      status: "cancelled",
    },
  });

  // 2. Fetch all active (non-refunded, non-cancelled) registrations.
  const regs = await prisma.eventRegistration.findMany({
    where: {
      event_id: eventId,
      OR: [{ refund_status: null }, { refund_status: "failed" }],
      cancelled_at: null,
    },
    select: { id: true, payment_status: true },
  });

  console.log(
    "[cancelEvent] processing",
    regs.length,
    "registrations for refund",
  );

  const results: Array<{
    registration_id: number;
    refund_id: string | null;
    already_refunded: boolean;
    error?: string;
  }> = [];

  // SAFETY NOTE — refund → promotion ordering:
  //   • Each refundRegistrationInternal() call commits its DB transaction
  //     (capacity rollback) BEFORE we move on. Promotion is invoked only
  //     once per cancel-event run, AFTER all refund txs are committed,
  //     so promoteNextEligible always reads fresh capacity.
  //   • For the bulk-cancel path below, the event is already marked
  //     cancelled (step 1), so promotion would refuse anyway — we skip it.
  //
  // Chunked parallelism (size = REFUND_CONCURRENCY) keeps Razorpay's
  // refund-API rate limits respected while still finishing large events
  // quickly. Promise.allSettled means one failure never aborts the batch.
  const REFUND_CONCURRENCY = 5;
  for (let i = 0; i < regs.length; i += REFUND_CONCURRENCY) {
    const slice = regs.slice(i, i + REFUND_CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((r) =>
        refundRegistrationInternal({
          registrationId: r.id,
          reason: reason ?? "Event cancelled by organizer",
        }).then((result) => ({ id: r.id, result })),
      ),
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      const r = slice[j];
      if (s.status === "fulfilled") {
        results.push({
          registration_id: s.value.id,
          refund_id: s.value.result.refundId,
          already_refunded: s.value.result.alreadyRefunded,
        });
      } else {
        const err: any = s.reason;
        logger.error("REFUND_FAILED", {
          eventId,
          registrationId: r.id,
          code: err?.code,
          err: String(err?.message ?? err).slice(0, 200),
        });
        results.push({
          registration_id: r.id,
          refund_id: null,
          already_refunded: false,
          error: err?.code ?? err?.message ?? "unknown",
        });
      }
    }
  }

  // 3. Cancel all 'waiting' waitlist entries — event is cancelled so they
  //    can never be promoted.
  await prisma.eventWaitlist.updateMany({
    where: { event_id: eventId, status: "waiting" },
    data: { status: "cancelled" },
  });

  console.log(
    "[cancelEvent] DONE — eventId:",
    eventId,
    "refunds attempted:",
    results.length,
  );

  res.json({
    event_id: eventId,
    cancelled_at: new Date(),
    refunds_attempted: results.length,
    refunds: results,
  });
}

// ─── Route: POST /events/:id/partial-cancel ──────────────────────────
// Authenticated user cancels N tickets from their OWN registration.
// If all remaining active tickets are cancelled, the registration is fully refunded/cancelled.

export async function partialCancelTickets(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const userId = req.user!.userId;
  const cancelCount = parseInt(String(req.body?.cancel_count ?? ""), 10);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : undefined;

  if (!Number.isFinite(cancelCount) || cancelCount < 1) {
    res.status(400).json({ error: "cancel_count must be a positive integer" });
    return;
  }

  const regFound = await prisma.eventRegistration.findFirst({
    where: { event_id: eventId, user_id: userId },
    select: {
      id: true,
      event_id: true,
      user_id: true,
      ticket_count: true,
      cancelled_count: true,
      payment_status: true,
      payment_id: true,
      amount_paid: true,
      refund_status: true,
      ticket_tier_id: true,
      checked_in: true,
      cancelled_at: true,
    },
  });

  if (!regFound) {
    res.status(404).json({ error: "Registration not found for this event" });
    return;
  }
  let reg = regFound;
  if (reg.cancelled_at || reg.refund_status === "refunded") {
    res.status(409).json({ error: "Registration is already fully cancelled or refunded" });
    return;
  }
  if (reg.checked_in) {
    res.status(409).json({ error: "Cannot cancel tickets that have already been checked in" });
    return;
  }

  let activeTickets = reg.ticket_count - (reg.cancelled_count ?? 0);
  if (cancelCount > activeTickets) {
    res.status(400).json({
      error: `Cannot cancel ${cancelCount} tickets — only ${activeTickets} active ticket(s) remaining`,
      active_tickets: activeTickets,
    });
    return;
  }
  let isFullCancel = cancelCount === activeTickets;

  // Calculate partial refund amount proportional to the cancelled tickets
  let refundId: string | null = null;
  let partialRefundAmount: number | null = null;

  const paymentId = reg.payment_id;
  const amountPaid = reg.amount_paid;
  if (reg.payment_status === "paid" && paymentId && amountPaid !== null) {
    const queueDeadline = Date.now() + 12_000;
    let claimed = 0;
    while (Date.now() < queueDeadline) {
      // Claim processing lock only if row state is unchanged for cancelled_count.
      // This serializes rapid double-taps and cross-request races.
      claimed = await prisma.$executeRaw(
        Prisma.sql`UPDATE "EventRegistration"
                   SET "refund_status" = 'processing'
                   WHERE "id" = ${reg.id}
                     AND "cancelled_count" = ${reg.cancelled_count ?? 0}
                     AND ("refund_status" IS NULL OR "refund_status" = 'failed' OR "refund_status" = 'partial_refund')`,
      );
      if (claimed === 1) break;

      const latest: {
        ticket_count: number;
        cancelled_count: number;
        refund_status: string | null;
        checked_in: boolean;
        cancelled_at: Date | null;
      } | null = await prisma.eventRegistration.findUnique({
        where: { id: reg.id },
        select: {
          ticket_count: true,
          cancelled_count: true,
          refund_status: true,
          checked_in: true,
          cancelled_at: true,
        },
      });

      if (!latest) {
        res.status(404).json({ error: "Registration not found for this event" });
        return;
      }
      if (latest.cancelled_at || latest.refund_status === "refunded") {
        res.status(409).json({ error: "Registration is already fully cancelled or refunded" });
        return;
      }
      if (latest.checked_in) {
        res.status(409).json({ error: "Cannot cancel tickets that have already been checked in" });
        return;
      }

      reg = { ...reg, ...latest };
      activeTickets = reg.ticket_count - (reg.cancelled_count ?? 0);
      if (cancelCount > activeTickets) {
        res.status(400).json({
          error: `Cannot cancel ${cancelCount} tickets — only ${activeTickets} active ticket(s) remaining`,
          active_tickets: activeTickets,
        });
        return;
      }

      // Another request is actively processing; wait in queue and retry.
      if (latest.refund_status === "processing") {
        await sleep(700);
      } else {
        // State changed quickly (e.g. another partial just finished); short backoff then retry claim.
        await sleep(200);
      }
    }

    if (claimed === 0) {
      res.status(409).json({
        error: "Another partial refund is being processed. Please retry in a few seconds.",
        code: "REFUND_IN_PROGRESS",
      });
      return;
    }

    // Recompute with latest state after queue wait/claim.
    activeTickets = reg.ticket_count - (reg.cancelled_count ?? 0);
    isFullCancel = cancelCount === activeTickets;

    const perTicketAmount = amountPaid / reg.ticket_count;
    const amountToRefund = Math.round(perTicketAmount * cancelCount * 100); // paise

    try {
      const refund = await refundRazorpayPayment({
        paymentId,
        amountPaise: amountToRefund,
        notes: { reason: reason ?? `Partial ticket cancellation: ${cancelCount} ticket(s)` },
      });
      refundId = refund.id;
      partialRefundAmount = refund.amount / 100;
    } catch (err: any) {
      console.error("[partialCancel] Razorpay ERROR — regId:", reg.id, err?.message ?? err);
      await prisma.eventRegistration.update({
        where: { id: reg.id },
        data: { refund_status: "failed" },
      });
      res.status(502).json({ error: "Refund failed at payment provider", code: "REFUND_PROVIDER_FAILED" });
      return;
    }
  }

  // Atomic DB update
  await prisma.$transaction(async (tx) => {
    const newCancelledCount = (reg.cancelled_count ?? 0) + cancelCount;
    await tx.eventRegistration.update({
      where: { id: reg.id },
      data: {
        cancelled_count: newCancelledCount,
        refund_status: isFullCancel ? "refunded" : (refundId ? "partial_refund" : reg.refund_status),
        refund_id: refundId ?? undefined,
        // Keep semantics aligned with other flows: refund_amount = refunded amount for this operation.
        refund_amount: partialRefundAmount !== null ? partialRefundAmount : undefined,
        cancelled_at: isFullCancel ? new Date() : undefined,
        payment_status: isFullCancel && reg.payment_status === "paid" ? "refunded" : reg.payment_status,
      },
    });

    // Roll back capacity for cancelled tickets
    await tx.$executeRaw(
      Prisma.sql`UPDATE "Event"
                 SET "attendee_count" = GREATEST(0, "attendee_count" - ${cancelCount})
                 WHERE "id" = ${reg.event_id}`,
    );
    if (reg.ticket_tier_id) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE "EventTicketTier"
                   SET "quantity_sold" = GREATEST(0, "quantity_sold" - ${cancelCount}),
                       "updated_at"    = NOW()
                   WHERE "id" = ${reg.ticket_tier_id}`,
      );
    }
  });

  console.log(
    "[partialCancel] regId:", reg.id,
    "cancelled:", cancelCount, "of", reg.ticket_count,
    "isFullCancel:", isFullCancel,
    "refundId:", refundId,
  );

  // Best-effort notification
  try {
    const user = await prisma.user.findUnique({
      where: { id: reg.user_id },
      select: { id: true, push_token: true },
    });
    const io = getIO();
    if (io) {
      io.to(`user:${reg.user_id}`).emit("event:partial_cancelled", {
        type: "event:partial_cancelled",
        registrationId: reg.id,
        eventId: reg.event_id,
        cancelledCount: cancelCount,
        refundId,
        isFullCancel,
      });
    }
    if (user?.push_token) {
      sendExpoPushNotification(
        user.push_token,
        isFullCancel ? "Tickets cancelled & refunded" : `${cancelCount} ticket(s) cancelled`,
        isFullCancel
          ? "All your tickets have been cancelled and refunded."
          : `${cancelCount} ticket(s) cancelled. ${activeTickets - cancelCount} ticket(s) remain.`,
        { screen: "Events" },
      );
    }
  } catch {/* non-blocking */}

  // If freed capacity allows waitlist promotion
  if (isFullCancel) {
    try {
      await promoteNextEligible(eventId, 10);
    } catch (e: any) {
      logger.warn("WAITLIST_PROMOTION_SKIPPED", {
        eventId,
        registrationId: reg.id,
        err: String(e?.message ?? e).slice(0, 200),
      });
    }
  }

  res.json({
    registration_id: reg.id,
    cancelled_count: cancelCount,
    remaining_active_tickets: activeTickets - cancelCount,
    is_fully_cancelled: isFullCancel,
    refund_id: refundId,
    refund_amount: partialRefundAmount,
  });
}
