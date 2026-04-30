import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { verifyRazorpayWebhookSignature } from "../services/razorpayService";
import { promoteNextEligible } from "./waitlistController";
import { logger } from "../utils/logger";

/**
 * Phase 5 — POST /webhooks/razorpay
 *
 * Mounted with express.raw({ type: "application/json" }) so we can verify
 * the HMAC signature against the EXACT raw body. Handlers must read
 * (req as any).rawBody.
 *
 * Idempotency: every event is recorded in `RazorpayWebhookEvent` with a
 * unique `event_id` (the `id` field from the webhook payload). On replay
 * we short-circuit with 200 — Razorpay's retry policy considers anything
 * non-2xx a failure and will re-deliver, so we MUST 200 on duplicates.
 *
 * Supported events:
 *   • payment.captured  → mark registration paid
 *   • payment.failed    → mark registration failed
 *   • refund.created    → mark refund_status="refunded", roll back capacity,
 *                         attempt waitlist promotion
 *
 * Unknown events → recorded as processed=true with a "skipped" status so
 * we never re-process them on retry.
 */

interface RazorpayWebhookPayload {
  entity?: string;
  event?: string;
  account_id?: string;
  contains?: string[];
  payload?: {
    payment?: { entity?: any };
    refund?:  { entity?: any };
    order?:   { entity?: any };
  };
  created_at?: number;
}

function getEventId(req: Request, body: RazorpayWebhookPayload): string | null {
  // Razorpay puts the unique event id in `x-razorpay-event-id`.
  // Falls back to the payload payment/refund entity id + event type for safety.
  const headerId = (req.headers["x-razorpay-event-id"] as string | undefined) || null;
  if (headerId && headerId.length > 0) return headerId;
  const paymentId = body?.payload?.payment?.entity?.id;
  const refundId = body?.payload?.refund?.entity?.id;
  const evt = body?.event ?? "unknown";
  if (paymentId) return `${evt}:${paymentId}`;
  if (refundId) return `${evt}:${refundId}`;
  return null;
}

export async function handleRazorpayWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  // ── 1. Signature verification on RAW body
  const signature = (req.headers["x-razorpay-signature"] as string | undefined) || "";
  const rawBody: string =
    (req as any).rawBody ??
    (Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "");
  if (!rawBody) {
    console.error("[razorpayWebhook] REJECTED — empty raw body");
    res.status(400).json({ error: "Missing body" });
    return;
  }
  let sigOk = false;
  try {
    sigOk = verifyRazorpayWebhookSignature(rawBody, signature);
  } catch (e) {
    console.error("[razorpayWebhook] config error:", e);
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }
  if (!sigOk) {
    console.error("[razorpayWebhook] REJECTED — bad signature");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  // ── 2. Parse body
  let body: RazorpayWebhookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const eventType = body.event ?? "unknown";
  const eventId = getEventId(req, body);
  if (!eventId) {
    res.status(400).json({ error: "Missing event id" });
    return;
  }

  // ── 3. Idempotency: atomic INSERT … ON CONFLICT DO NOTHING RETURNING id.
  //     Two concurrent webhook deliveries (Razorpay retries, multi-instance
  //     fan-out) race on this single SQL statement. Postgres serializes the
  //     unique-index check inside the INSERT; the loser gets 0 rows back
  //     and we short-circuit BEFORE doing any handler work, so refunds /
  //     payment-status flips can never run twice.
  let isNew = false;
  try {
    const inserted = await prisma.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`INSERT INTO "RazorpayWebhookEvent"
                   ("event_id", "event_type", "payload", "status", "processed", "created_at")
                 VALUES
                   (${eventId}, ${eventType}, ${JSON.stringify(body)}::jsonb, 'received', false, NOW())
                 ON CONFLICT ("event_id") DO NOTHING
                 RETURNING "id"`,
    );
    isNew = inserted.length > 0;
  } catch (e: any) {
    logger.error("WEBHOOK_DB_INSERT_FAILED", {
      eventId,
      eventType,
      err: String(e?.message ?? e).slice(0, 200),
    });
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  if (!isNew) {
    logger.info("WEBHOOK_DUPLICATE", { eventId, eventType });
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  // ── 4. Dispatch (always 200 to Razorpay; record errors on the row)
  try {
    switch (eventType) {
      case "payment.captured":
        await handlePaymentCaptured(body);
        break;
      case "payment.failed":
        await handlePaymentFailed(body);
        break;
      case "refund.created":
      case "refund.processed":
        await handleRefundCreated(body);
        break;
      default:
        console.log("[razorpayWebhook] unsupported event:", eventType);
        await prisma.razorpayWebhookEvent.update({
          where: { event_id: eventId },
          data:  { status: "skipped", processed: true, processed_at: new Date() },
        });
        res.status(200).json({ ok: true, skipped: true });
        return;
    }

    await prisma.razorpayWebhookEvent.update({
      where: { event_id: eventId },
      data:  { status: "processed", processed: true, processed_at: new Date() },
    });
    logger.info("WEBHOOK_PROCESSED", { eventId, eventType });
    res.status(200).json({ ok: true });
  } catch (err: any) {
    logger.error("WEBHOOK_HANDLER_ERROR", {
      eventId,
      eventType,
      err: String(err?.message ?? err).slice(0, 500),
    });
    // Mark failure but still 200: 4xx/5xx triggers Razorpay retry.
    // We've already deduped via the unique event_id, so retries would no-op.
    // Storing the error lets ops investigate.
    try {
      await prisma.razorpayWebhookEvent.update({
        where: { event_id: eventId },
        data: {
          status: "error",
          processed: true,
          processed_at: new Date(),
          error: String(err?.message ?? err).slice(0, 500),
        },
      });
    } catch {/* swallow */}
    void isNew;
    res.status(200).json({ ok: true, error: "handler_failed" });
  }
}

// ─── handlers ────────────────────────────────────────────────────────

async function handlePaymentCaptured(body: RazorpayWebhookPayload): Promise<void> {
  const payment = body?.payload?.payment?.entity;
  const paymentId = payment?.id;
  const orderId = payment?.order_id;
  if (!paymentId) {
    console.log("[razorpayWebhook.captured] missing payment.id");
    return;
  }
  // Find by payment_id first, fall back to order_id.
  const reg = await prisma.eventRegistration.findFirst({
    where: { OR: [{ payment_id: paymentId }, { payment_order_id: orderId ?? "__none__" }] },
    select: { id: true, payment_status: true },
  });
  if (!reg) {
    console.log(
      "[razorpayWebhook.captured] no registration for paymentId:",
      paymentId,
      "orderId:",
      orderId,
    );
    return;
  }
  if (reg.payment_status === "paid") return; // already settled
  await prisma.eventRegistration.update({
    where: { id: reg.id },
    data:  { payment_status: "paid", payment_id: paymentId },
  });
  console.log("[razorpayWebhook.captured] regId:", reg.id, "marked paid");
}

async function handlePaymentFailed(body: RazorpayWebhookPayload): Promise<void> {
  const payment = body?.payload?.payment?.entity;
  const paymentId = payment?.id;
  const orderId = payment?.order_id;
  if (!paymentId && !orderId) return;
  const reg = await prisma.eventRegistration.findFirst({
    where: paymentId
      ? { payment_id: paymentId }
      : { payment_order_id: orderId },
    select: { id: true, payment_status: true },
  });
  if (!reg) return;
  if (reg.payment_status === "failed") return;
  await prisma.eventRegistration.update({
    where: { id: reg.id },
    data:  { payment_status: "failed" },
  });
  console.log("[razorpayWebhook.failed] regId:", reg.id, "marked failed");
}

/**
 * On refund.created we mark the registration refunded, then ATOMICALLY
 * roll back the capacity counters (attendee_count and tier.quantity_sold)
 * and try to promote the next waitlist user. The capacity rollback uses
 * GREATEST(0, …) so a double-refund webhook can never push counts negative.
 */
async function handleRefundCreated(body: RazorpayWebhookPayload): Promise<void> {
  const refund = body?.payload?.refund?.entity;
  const refundId = refund?.id;
  const paymentId = refund?.payment_id;
  if (!refundId || !paymentId) {
    console.log("[razorpayWebhook.refund] missing fields");
    return;
  }
  const reg = await prisma.eventRegistration.findFirst({
    where: { payment_id: paymentId },
    select: {
      id: true,
      event_id: true,
      ticket_count: true,
      ticket_tier_id: true,
      refund_status: true,
    },
  });
  if (!reg) {
    console.log("[razorpayWebhook.refund] no registration for paymentId:", paymentId);
    return;
  }
  if (reg.refund_status === "refunded") {
    console.log("[razorpayWebhook.refund] already refunded — regId:", reg.id);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.eventRegistration.update({
      where: { id: reg.id },
      data: {
        refund_status: "refunded",
        refund_id: refundId,
        refund_amount: refund?.amount ? refund.amount / 100 : undefined,
        cancelled_at: new Date(),
        payment_status: "refunded",
      },
    });
    // Roll back event capacity (clamped at 0)
    await tx.$executeRaw(
      Prisma.sql`UPDATE "Event"
                 SET "attendee_count" = GREATEST(0, "attendee_count" - ${reg.ticket_count})
                 WHERE "id" = ${reg.event_id}`,
    );
    // Roll back tier capacity if applicable
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
    "[razorpayWebhook.refund] regId:",
    reg.id,
    "refunded; capacity rolled back",
  );

  // Best-effort waitlist promotion (outside tx)
  try {
    await promoteNextEligible(reg.event_id, 10);
  } catch (e: any) {
    console.log(
      "[razorpayWebhook.refund] post-refund promotion skipped:",
      e?.code ?? e?.message ?? "unknown",
    );
  }
}
