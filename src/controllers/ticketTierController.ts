import { Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { paramInt } from "../utils/params";

/**
 * Phase 3 — EventTicketTier CRUD.
 *
 * Routes:
 *   POST   /events/:id/tickets
 *   PUT    /events/:id/tickets/:tierId
 *   DELETE /events/:id/tickets/:tierId
 *
 * Authorization: only event organizer (via business_promotion or business)
 *                or admin.
 *
 * Validation:
 *   - price >= 0
 *   - quantity_total >= 0 OR null
 *   - min_per_order <= max_per_order
 *
 * Side effect: when an event gets its first real tier, we automatically flip
 * `is_legacy = false` so the decorator stops short-circuiting to virtual
 * tiers. Existing 900+ events remain `is_legacy = true` until an organizer
 * explicitly creates a tier on them.
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

interface TierBody {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  currency?: unknown;
  quantity_total?: unknown;
  sort_order?: unknown;
  is_active?: unknown;
  sale_starts_at?: unknown;
  sale_ends_at?: unknown;
  min_per_order?: unknown;
  max_per_order?: unknown;
}

interface TierData {
  name: string;
  description: string | null;
  price: number;
  currency: string;
  quantity_total: number | null;
  sort_order: number;
  is_active: boolean;
  sale_starts_at: Date | null;
  sale_ends_at: Date | null;
  min_per_order: number;
  max_per_order: number;
}

function validateTierInput(
  body: TierBody,
  partial: boolean,
): { ok: true; data: Partial<TierData> } | { ok: false; error: string } {
  const out: Partial<TierData> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0)
      return { ok: false, error: "name must be a non-empty string" };
    out.name = body.name.trim();
  } else if (!partial) {
    return { ok: false, error: "name is required" };
  }

  if (body.description !== undefined) {
    out.description =
      body.description === null
        ? null
        : typeof body.description === "string"
          ? body.description
          : String(body.description);
  }

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0)
      return { ok: false, error: "price must be a non-negative number" };
    out.price = price;
  } else if (!partial) {
    out.price = 0;
  }

  if (body.currency !== undefined) {
    if (typeof body.currency !== "string" || body.currency.length === 0)
      return { ok: false, error: "currency must be a string" };
    out.currency = body.currency.toUpperCase();
  }

  if (body.quantity_total !== undefined) {
    if (body.quantity_total === null) {
      out.quantity_total = null;
    } else {
      const qt = Number(body.quantity_total);
      if (!Number.isFinite(qt) || qt < 0 || !Number.isInteger(qt))
        return {
          ok: false,
          error: "quantity_total must be a non-negative integer or null",
        };
      out.quantity_total = qt;
    }
  }

  if (body.sort_order !== undefined) {
    const so = Number(body.sort_order);
    if (!Number.isFinite(so) || !Number.isInteger(so))
      return { ok: false, error: "sort_order must be an integer" };
    out.sort_order = so;
  }

  if (body.is_active !== undefined) {
    out.is_active = Boolean(body.is_active);
  }

  if (body.sale_starts_at !== undefined) {
    if (body.sale_starts_at === null) out.sale_starts_at = null;
    else {
      const d = new Date(String(body.sale_starts_at));
      if (Number.isNaN(d.getTime()))
        return { ok: false, error: "sale_starts_at is not a valid date" };
      out.sale_starts_at = d;
    }
  }

  if (body.sale_ends_at !== undefined) {
    if (body.sale_ends_at === null) out.sale_ends_at = null;
    else {
      const d = new Date(String(body.sale_ends_at));
      if (Number.isNaN(d.getTime()))
        return { ok: false, error: "sale_ends_at is not a valid date" };
      out.sale_ends_at = d;
    }
  }

  if (body.min_per_order !== undefined) {
    const v = Number(body.min_per_order);
    if (!Number.isFinite(v) || v < 1 || !Number.isInteger(v))
      return {
        ok: false,
        error: "min_per_order must be a positive integer",
      };
    out.min_per_order = v;
  }

  if (body.max_per_order !== undefined) {
    const v = Number(body.max_per_order);
    if (!Number.isFinite(v) || v < 1 || !Number.isInteger(v))
      return {
        ok: false,
        error: "max_per_order must be a positive integer",
      };
    out.max_per_order = v;
  }

  // Cross-field invariant
  const minP = out.min_per_order;
  const maxP = out.max_per_order;
  if (minP !== undefined && maxP !== undefined && minP > maxP) {
    return { ok: false, error: "min_per_order cannot exceed max_per_order" };
  }

  // Sale window invariant
  if (
    out.sale_starts_at &&
    out.sale_ends_at &&
    out.sale_starts_at > out.sale_ends_at
  ) {
    return { ok: false, error: "sale_starts_at must be before sale_ends_at" };
  }

  return { ok: true, data: out };
}

export async function createTicketTier(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  console.log(
    "[createTicketTier] eventId:",
    eventId,
    "userId:",
    req.user!.userId,
    "body:",
    JSON.stringify(req.body),
  );

  const event = await loadEventForOwnerCheck(eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!isOwnerOrAdmin(event, req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const v = validateTierInput(req.body ?? {}, false);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }

  try {
    const tier = await prisma.$transaction(async (tx) => {
      const created = await tx.eventTicketTier.create({
        data: {
          event_id: eventId,
          name: v.data.name as string,
          description: v.data.description ?? null,
          price: (v.data.price ?? 0) as number,
          currency: (v.data.currency ?? "INR") as string,
          quantity_total:
            v.data.quantity_total === undefined
              ? null
              : (v.data.quantity_total as number | null),
          sort_order: (v.data.sort_order ?? 0) as number,
          is_active: v.data.is_active ?? true,
          sale_starts_at: v.data.sale_starts_at ?? null,
          sale_ends_at: v.data.sale_ends_at ?? null,
          min_per_order: (v.data.min_per_order ?? 1) as number,
          max_per_order: (v.data.max_per_order ?? 10) as number,
        },
      });

      // First real tier on this event → flip is_legacy = false so the
      // decorator starts using real tiers from the next read.
      if (event.is_legacy) {
        await tx.event.update({
          where: { id: eventId },
          data: { is_legacy: false },
        });
      }

      return created;
    });

    console.log("[createTicketTier] SUCCESS — tierId:", tier.id);
    res.status(201).json(tier);
  } catch (err) {
    console.error("[createTicketTier] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateTicketTier(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const tierId = paramInt(req.params.tierId);
  console.log(
    "[updateTicketTier] eventId:",
    eventId,
    "tierId:",
    tierId,
    "userId:",
    req.user!.userId,
  );

  const event = await loadEventForOwnerCheck(eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!isOwnerOrAdmin(event, req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const tier = await prisma.eventTicketTier.findUnique({
    where: { id: tierId },
  });
  if (!tier || tier.event_id !== eventId) {
    res.status(404).json({ error: "Ticket tier not found" });
    return;
  }

  const v = validateTierInput(req.body ?? {}, true);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }

  // Cross-field check using existing values when only one of min/max given.
  const finalMin = v.data.min_per_order ?? tier.min_per_order;
  const finalMax = v.data.max_per_order ?? tier.max_per_order;
  if (finalMin > finalMax) {
    res
      .status(400)
      .json({ error: "min_per_order cannot exceed max_per_order" });
    return;
  }

  // Cannot reduce quantity_total below quantity_sold
  if (
    v.data.quantity_total !== undefined &&
    v.data.quantity_total !== null &&
    v.data.quantity_total < tier.quantity_sold
  ) {
    res.status(400).json({
      error: "quantity_total cannot be less than already-sold quantity",
    });
    return;
  }

  try {
    const updated = await prisma.eventTicketTier.update({
      where: { id: tierId },
      data: v.data as any,
    });
    console.log("[updateTicketTier] SUCCESS — tierId:", updated.id);
    res.json(updated);
  } catch (err) {
    console.error("[updateTicketTier] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteTicketTier(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const tierId = paramInt(req.params.tierId);
  console.log(
    "[deleteTicketTier] eventId:",
    eventId,
    "tierId:",
    tierId,
    "userId:",
    req.user!.userId,
  );

  const event = await loadEventForOwnerCheck(eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!isOwnerOrAdmin(event, req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const tier = await prisma.eventTicketTier.findUnique({
    where: { id: tierId },
  });
  if (!tier || tier.event_id !== eventId) {
    res.status(404).json({ error: "Ticket tier not found" });
    return;
  }

  if (tier.quantity_sold > 0) {
    res
      .status(409)
      .json({ error: "Cannot delete a tier with active registrations" });
    return;
  }

  try {
    await prisma.eventTicketTier.delete({ where: { id: tierId } });
    console.log("[deleteTicketTier] SUCCESS — tierId:", tierId);
    res.status(204).end();
  } catch (err) {
    console.error("[deleteTicketTier] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function listTicketTiers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  try {
    const tiers = await prisma.eventTicketTier.findMany({
      where: { event_id: eventId },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    });
    res.json(tiers);
  } catch (err) {
    console.error("[listTicketTiers] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
