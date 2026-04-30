import { Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { paramInt } from "../utils/params";

/**
 * Phase 5 — Event analytics.
 *
 * Route: GET /events/:id/analytics  (organizer / admin)
 *
 * Counts:
 *   • views          — Event.views_count
 *   • registrations  — total non-refunded, non-cancelled regs
 *   • check_ins      — registrations where checked_in = true
 *   • conversion_rate = check_ins / registrations  (0 when registrations=0)
 */

export async function getEventAnalytics(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const id = paramInt(req.params.id);

  const event = await prisma.event.findUnique({
    where: { id },
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

  // Conversion is computed against VALID registrations only —
  // refunded and cancelled rows are excluded (matches `registrations`
  // count above), so the rate is meaningful even after refunds.
  const [registrations, checkIns] = await Promise.all([
    prisma.eventRegistration.count({
      where: {
        event_id: id,
        cancelled_at: null,
        OR: [{ refund_status: null }, { refund_status: "failed" }],
      },
    }),
    prisma.eventRegistration.count({
      where: {
        event_id: id,
        checked_in: true,
        cancelled_at: null,
        OR: [{ refund_status: null }, { refund_status: "failed" }],
      },
    }),
  ]);

  const views = event.views_count ?? 0;
  const conversionRate =
    registrations > 0 ? Number((checkIns / registrations).toFixed(4)) : 0;

  res.json({
    event_id: id,
    views,
    registrations,
    check_ins: checkIns,
    conversion_rate: conversionRate,
  });
}
