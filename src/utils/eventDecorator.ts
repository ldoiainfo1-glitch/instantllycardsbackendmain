/**
 * Event response decorator — Phase 2 (backward-compatible).
 *
 * Attaches a synthesized `ticket_tiers` array to every event response so the
 * mobile client can use a single rendering path regardless of whether the
 * event was created under the legacy `ticket_price` model or the new
 * EventTicketTier model.
 *
 * Rules:
 *  - If real EventTicketTier rows exist for the event → return them as-is
 *    plus their computed availability fields.
 *  - Otherwise → synthesize ONE "virtual" tier called "General" derived from
 *    the legacy fields (`ticket_price`, `max_attendees`, `attendee_count`).
 *    The virtual tier has `id: null` and `is_virtual: true` so the client can
 *    distinguish it if needed.
 *
 * NOTHING existing is removed or renamed. We only ADD fields.
 */

import prisma from "./prisma";

export interface DecoratedTier {
  id: number | null;
  event_id: number;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  quantity_total: number | null;
  quantity_sold: number;
  quantity_available: number | null;
  sort_order: number;
  is_active: boolean;
  is_virtual: boolean;
  is_sold_out: boolean;
  is_free: boolean;
  sale_starts_at: Date | string | null;
  sale_ends_at: Date | string | null;
  min_per_order: number;
  max_per_order: number;
  is_on_sale: boolean;
}

interface MinimalEvent {
  id: number;
  ticket_price?: number | null;
  max_attendees?: number | null;
  attendee_count?: number | null;
  is_legacy?: boolean | null;
  ticket_tiers?: any[];
}

function buildVirtualTier(event: MinimalEvent): DecoratedTier {
  const price = Number(event.ticket_price ?? 0) || 0;
  const total =
    typeof event.max_attendees === "number" && event.max_attendees > 0
      ? event.max_attendees
      : null;
  const sold =
    typeof event.attendee_count === "number" && event.attendee_count > 0
      ? event.attendee_count
      : 0;
  const quantity_available =
    total !== null ? Math.max(0, total - sold) : null;
  const is_free = price === 0;

  return {
    id: null,
    event_id: event.id,
    name: "General",
    description: null,
    price,
    currency: "INR",
    quantity_total: total,
    quantity_sold: sold,
    quantity_available,
    sort_order: 0,
    is_active: true,
    is_virtual: true,
    is_sold_out: total !== null && quantity_available === 0,
    is_free,
    sale_starts_at: null,
    sale_ends_at: null,
    min_per_order: 1,
    max_per_order: 10,
    is_on_sale: true,
  };
}

function decorateRealTier(t: any): DecoratedTier {
  const total =
    typeof t.quantity_total === "number" && t.quantity_total > 0
      ? t.quantity_total
      : null;
  const sold = typeof t.quantity_sold === "number" ? t.quantity_sold : 0;
  const quantity_available =
    total !== null ? Math.max(0, total - sold) : null;
  const price = Number(t.price ?? 0) || 0;
  const is_free = price === 0;

  const now = new Date();
  const startsAt = t.sale_starts_at ? new Date(t.sale_starts_at) : null;
  const endsAt = t.sale_ends_at ? new Date(t.sale_ends_at) : null;
  const is_on_sale =
    !!t.is_active &&
    (!startsAt || now >= startsAt) &&
    (!endsAt || now <= endsAt);

  return {
    id: t.id,
    event_id: t.event_id,
    name: t.name,
    description: t.description ?? null,
    price,
    currency: t.currency ?? "INR",
    quantity_total: total,
    quantity_sold: sold,
    quantity_available,
    sort_order: t.sort_order ?? 0,
    is_active: !!t.is_active,
    is_virtual: false,
    is_sold_out: total !== null && quantity_available === 0,
    is_free,
    sale_starts_at: t.sale_starts_at ?? null,
    sale_ends_at: t.sale_ends_at ?? null,
    min_per_order: t.min_per_order ?? 1,
    max_per_order: t.max_per_order ?? 10,
    is_on_sale,
  };
}

/**
 * Build the `ticket_tiers` array for one event.
 *
 * Rule of precedence:
 *   1. event.is_legacy === true  -> ALWAYS virtual tier (skip any real tiers,
 *      no heavy processing). This protects all 900+ pre-existing rows.
 *   2. real tiers loaded via include -> decorate + stable-sort.
 *   3. fallback -> single virtual "General" tier.
 */
export function buildTicketTiers(event: MinimalEvent): DecoratedTier[] {
  if (event.is_legacy === true) {
    return [buildVirtualTier(event)];
  }
  const real = Array.isArray(event.ticket_tiers) ? event.ticket_tiers : [];
  if (real.length > 0) {
    return real
      .map(decorateRealTier)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order || (a.id ?? 0) - (b.id ?? 0),
      );
  }
  return [buildVirtualTier(event)];
}

/**
 * Decorate a single event with `ticket_tiers`. Spread-preserves every
 * existing field — purely additive.
 *
 * Performance: legacy events skip the real-tier decoration loop entirely.
 */
export function decorateEvent<T extends MinimalEvent>(
  event: T,
): T & { ticket_tiers: DecoratedTier[]; has_real_tiers: boolean } {
  const isLegacy = event.is_legacy === true;
  const tiers = buildTicketTiers(event);
  const hasReal =
    !isLegacy &&
    Array.isArray(event.ticket_tiers) &&
    event.ticket_tiers.length > 0;
  return {
    ...event,
    ticket_tiers: tiers,
    has_real_tiers: hasReal,
  };
}

/**
 * Decorate a list of events.
 */
export function decorateEvents<T extends MinimalEvent>(events: T[]) {
  return events.map((e) => decorateEvent(e));
}

/**
 * Helper used by Phase 3+ — load tiers for an event id.
 * Returns either real tiers or a single synthesized General tier.
 */
export async function loadTiersForEvent(
  eventId: number,
): Promise<DecoratedTier[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      ticket_tiers: { orderBy: { sort_order: "asc" } },
    },
  });
  if (!event) return [];
  return buildTicketTiers(event as any);
}
