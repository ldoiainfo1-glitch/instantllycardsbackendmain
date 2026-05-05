import { Request, Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { paramInt, queryInt } from "../utils/params";
import crypto from "crypto";
import {
  createRazorpayOrder,
  fetchRazorpayOrder,
  getRazorpayPublicKey,
  verifyRazorpaySignature,
} from "../services/razorpayService";
import { getIO } from "../services/socketService";
import { sendExpoPushNotification } from "../utils/push";
import { notify } from "../utils/notify";
import { Prisma } from "@prisma/client";
import { decorateEvent, decorateEvents } from "../utils/eventDecorator";
import { logger } from "../utils/logger";
import { canAccessEvent } from "./eventStaffController";

function parseTicketCount(input: unknown): number {
  const count =
    input === undefined || input === null ? 1 : parseInt(String(input), 10);
  if (!Number.isFinite(count) || count <= 0) return 1;
  return count;
}

/**
 * Strict integer ticket_count parser used by the tier-aware flow.
 * Rejects: undefined, null, NaN, non-integer, <= 0, > 100.
 * Returns null on invalid — caller MUST 400 the request.
 *
 * Legacy `parseTicketCount` keeps its silent-coerce-to-1 behavior so
 * existing 900+ events on the legacy register flow are unaffected.
 */
function parseStrictTicketCount(input: unknown): number | null {
  if (input === undefined || input === null) return null;
  const raw = typeof input === "number" ? input : parseInt(String(input), 10);
  if (!Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  if (raw <= 0) return null;
  if (raw > 100) return null; // hard ceiling — sanity guard
  return raw;
}

function parseOptionalId(input: unknown): number | null {
  if (input === undefined || input === null || input === "") return null;
  const n = parseInt(String(input), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function calculateTicketAmountPaise(
  ticketPrice: number,
  ticketCount: number,
): number {
  return Math.round(ticketPrice * 100) * ticketCount;
}

async function notifyRegistrantRegistrationSuccess(args: {
  userId: number;
  eventId: number;
  eventTitle: string;
  ticketCount: number;
  paymentStatus: string;
  tierName?: string;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { push_token: true },
    });
    const io = getIO();
    if (io) {
      io.to(`user:${args.userId}`).emit("event:registration_confirmed", {
        type: "event:registration_confirmed",
        eventId: args.eventId,
        eventTitle: args.eventTitle,
        ticketCount: args.ticketCount,
        paymentStatus: args.paymentStatus,
        tierName: args.tierName,
      });
    }
    const isPaid = args.paymentStatus === "paid";
    const title = isPaid
      ? "Tickets purchased successfully"
      : "Registration successful";
    const tierPart = args.tierName ? ` (${args.tierName})` : "";
    const ticketPart =
      args.ticketCount > 1
        ? ` for ${args.ticketCount} tickets${tierPart}`
        : ` for 1 ticket${tierPart}`;
    const body = `You have registered for \"${args.eventTitle}\" successfully${ticketPart}.`;

    await notify({
      pushToken: user?.push_token,
      userId: args.userId,
      title,
      body,
      type: "event_registration",
      data: { screen: "MyPasses", eventId: args.eventId },
    });
  } catch {
    /* non-blocking */
  }
}

export async function listEvents(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;
  const city = req.query.city as string | undefined;
  const dateStr = req.query.date as string | undefined; // format: YYYY-MM-DD
  const priceType = req.query.priceType as string | undefined; // "free" or "paid"
  console.log(
    "[listEvents] page:",
    page,
    "limit:",
    limit,
    "search:",
    search,
    "category:",
    category,
    "city:",
    city,
    "date:",
    dateStr,
    "priceType:",
    priceType,
  );

  const where: any = {
    status: "active",
    date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
  };

  if (search) {
    const searchFilter = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
      { venue: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
      { state: { contains: search, mode: "insensitive" } },
      { event_type: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ];
    if (city) {
      // both search and city — use AND
      const cityFilter = [
        { city: { contains: city, mode: "insensitive" } },
        { venue: { contains: city, mode: "insensitive" } },
        { location: { contains: city, mode: "insensitive" } },
        { state: { contains: city, mode: "insensitive" } },
      ];
      where.AND = [{ OR: searchFilter }, { OR: cityFilter }];
    } else {
      where.OR = searchFilter;
    }
  } else if (city) {
    where.OR = [
      { city: { contains: city, mode: "insensitive" } },
      { venue: { contains: city, mode: "insensitive" } },
      { location: { contains: city, mode: "insensitive" } },
      { state: { contains: city, mode: "insensitive" } },
    ];
  }

  if (category) {
    where.category = { contains: category, mode: "insensitive" };
  }

  // Date filter: match events on the specified date (YYYY-MM-DD)
  if (dateStr) {
    try {
      const filterDate = new Date(dateStr);
      if (!Number.isNaN(filterDate.getTime())) {
        // Create range for the full day in UTC
        const dayStart = new Date(Date.UTC(
          filterDate.getUTCFullYear(),
          filterDate.getUTCMonth(),
          filterDate.getUTCDate()
        ));
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        where.date = { gte: dayStart, lt: dayEnd };
      }
    } catch (e) {
      console.warn("[listEvents] invalid date format:", dateStr);
    }
  }

  try {
    let [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ date: "asc" }, { id: "desc" }],
        include: {
          business: {
            select: {
              id: true,
              company_name: true,
              logo_url: true,
              full_name: true,
            },
          },
          ticket_tiers: { orderBy: { sort_order: "asc" } },
          _count: { select: { registrations: true } },
        },
      }),
      prisma.event.count({ where }),
    ]);

    // Price type filter (free vs paid) — done in memory since it depends on tier prices
    if (priceType === "free" || priceType === "paid") {
      events = events.filter((e) => {
        const hasPaidTier = (e.ticket_tiers as any[]).some((t: any) => t.price > 0);
        return priceType === "free" ? !hasPaidTier : hasPaidTier;
      });
      // Recalculate total after filtering
      total = events.length;
    }

    console.log("[listEvents] returned", events.length, "events of", total, "total");
    res.json({ data: decorateEvents(events as any[]), page, limit, total });
  } catch (err) {
    console.error("[listEvents] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getEvent(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  // Monitoring hook — captured by log aggregator for p95/p99 perf tracking.
  const _t0 = Date.now();
  logger.debug("PERF_EVENT_DETAIL_FETCH_START", { eventId: id });
  try {
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        business: {
          select: {
            id: true,
            company_name: true,
            logo_url: true,
            full_name: true,
            phone: true,
          },
        },
        ticket_tiers: { orderBy: { sort_order: "asc" } },
        _count: { select: { registrations: true } },
      },
    });
    if (!event) {
      logger.warn("EVENT_NOT_FOUND", { eventId: id });
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Fire-and-forget atomic views increment (doesn't block response).
    // Atomic SQL: UPDATE "Event" SET "views_count" = "views_count" + 1 WHERE id = ?
    prisma.event
      .update({ where: { id }, data: { views_count: { increment: 1 } } })
      .catch((e) => logger.error("VIEWS_INCREMENT_FAILED", {
        eventId: id,
        err: String(e?.message ?? e).slice(0, 200),
      }));
    res.json(decorateEvent(event as any));
    logger.debug("PERF_EVENT_DETAIL_FETCH", {
      eventId: id,
      durationMs: Date.now() - _t0,
      hasRealTiers:
        Array.isArray((event as any).ticket_tiers) &&
        (event as any).ticket_tiers.length > 0,
    });
  } catch (err: any) {
    logger.error("EVENT_DETAIL_FETCH_ERROR", {
      eventId: id,
      err: String(err?.message ?? err).slice(0, 200),
    });
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Return app-user contacts (friends) of the requester who are already
 * registered for the given event (paid or free).
 */
export async function getFriendAttendees(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const userId = req.user!.userId;

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true, cancelled_at: true },
    });

    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const contacts = await prisma.contact.findMany({
      where: {
        user_id: userId,
        is_app_user: true,
        app_user_id: { not: null },
      },
      select: {
        app_user_id: true,
        name: true,
      },
    });

    const contactNameByFriendId = new Map<number, string>();
    for (const c of contacts) {
      if (typeof c.app_user_id === "number" && c.app_user_id !== userId) {
        if (!contactNameByFriendId.has(c.app_user_id)) {
          contactNameByFriendId.set(c.app_user_id, c.name);
        }
      }
    }

    const friendIds = Array.from(contactNameByFriendId.keys());
    if (friendIds.length === 0) {
      res.json({
        event_id: eventId,
        total_friends_attending: 0,
        friends: [],
      });
      return;
    }

    const registrations = await prisma.eventRegistration.findMany({
      where: {
        event_id: eventId,
        user_id: { in: friendIds },
        cancelled_at: null,
        OR: [
          { refund_status: null },
          { refund_status: { notIn: ["refunded", "cancelled"] } },
        ],
      },
      select: {
        user_id: true,
        ticket_count: true,
        payment_status: true,
        registered_at: true,
      },
    });

    if (registrations.length === 0) {
      res.json({
        event_id: eventId,
        total_friends_attending: 0,
        friends: [],
      });
      return;
    }

    const aggregate = new Map<
      number,
      {
        user_id: number;
        tickets: number;
        registrations: number;
        has_paid_ticket: boolean;
        has_free_registration: boolean;
        last_registered_at: Date;
      }
    >();

    for (const reg of registrations) {
      const current = aggregate.get(reg.user_id);
      const isPaid = reg.payment_status === "paid";
      if (!current) {
        aggregate.set(reg.user_id, {
          user_id: reg.user_id,
          tickets: reg.ticket_count,
          registrations: 1,
          has_paid_ticket: isPaid,
          has_free_registration: !isPaid,
          last_registered_at: reg.registered_at,
        });
        continue;
      }

      current.tickets += reg.ticket_count;
      current.registrations += 1;
      current.has_paid_ticket = current.has_paid_ticket || isPaid;
      current.has_free_registration = current.has_free_registration || !isPaid;
      if (reg.registered_at > current.last_registered_at) {
        current.last_registered_at = reg.registered_at;
      }
    }

    const attendeeIds = Array.from(aggregate.keys());

    // Rank by how frequently the requester and friend have messaged each other.
    // This approximates "most-contacted friends first" for suggestion order.
    const interactionCountByFriendId = new Map<number, number>();
    if (attendeeIds.length > 0) {
      const interactionRows = await prisma.message.findMany({
        where: {
          OR: [
            {
              sender_id: userId,
              receiver_id: { in: attendeeIds },
            },
            {
              sender_id: { in: attendeeIds },
              receiver_id: userId,
            },
          ],
        },
        select: { sender_id: true, receiver_id: true },
      });

      for (const row of interactionRows) {
        const friendId =
          row.sender_id === userId ? row.receiver_id : row.sender_id;
        if (!friendId || friendId === userId) continue;
        interactionCountByFriendId.set(
          friendId,
          (interactionCountByFriendId.get(friendId) ?? 0) + 1,
        );
      }
    }

    const users = await prisma.user.findMany({
      where: { id: { in: attendeeIds } },
      select: { id: true, name: true, phone: true, profile_picture: true },
    });

    const userById = new Map(users.map((u) => [u.id, u]));

    const friends = attendeeIds
      .map((id) => {
        const stats = aggregate.get(id)!;
        const u = userById.get(id);
        const contactName = contactNameByFriendId.get(id);
        return {
          user_id: id,
          name: (contactName && contactName.trim()) || u?.name || u?.phone || "Friend",
          profile_picture: u?.profile_picture ?? null,
          tickets: stats.tickets,
          registrations: stats.registrations,
          has_paid_ticket: stats.has_paid_ticket,
          has_free_registration: stats.has_free_registration,
          interaction_count: interactionCountByFriendId.get(id) ?? 0,
          last_registered_at: stats.last_registered_at,
        };
      })
      .sort(
        (a, b) =>
          (b.interaction_count - a.interaction_count) ||
          (new Date(b.last_registered_at).getTime() -
            new Date(a.last_registered_at).getTime()),
      );

    res.json({
      event_id: eventId,
      total_friends_attending: friends.length,
      friends,
    });
  } catch (err) {
    console.error("[getFriendAttendees] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function listMyEvents(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const userId = req.user!.userId;
  console.log("[listMyEvents] userId:", userId);
  try {
    const promotions = await prisma.businessPromotion.findMany({
      where: { user_id: userId },
      select: { id: true },
    });
    const promotionIds = promotions.map((p) => p.id);

    // Also include events where user is a staff member
    const staffRows = await prisma.eventStaff.findMany({
      where: { user_id: userId },
      select: { event_id: true, role: true },
    });
    const staffEventIds = staffRows.map((s) => s.event_id);
    const staffRoleMap = new Map(staffRows.map((s) => [s.event_id, s.role]));

    const hasOwned = promotionIds.length > 0;
    const hasStaff = staffEventIds.length > 0;

    if (!hasOwned && !hasStaff) {
      res.json([]);
      return;
    }

    const whereClause: any = { parent_event_id: null };
    if (hasOwned && hasStaff) {
      whereClause.OR = [
        { business_promotion_id: { in: promotionIds } },
        { id: { in: staffEventIds } },
      ];
    } else if (hasOwned) {
      whereClause.business_promotion_id = { in: promotionIds };
    } else {
      whereClause.id = { in: staffEventIds };
    }

    const events = await prisma.event.findMany({
      where: whereClause,
      orderBy: { date: "desc" },
      include: {
        _count: { select: { registrations: true, occurrences: true } },
        business_promotion: {
          select: { id: true, business_name: true, business_card_id: true, user_id: true },
        },
        ticket_tiers: { orderBy: { sort_order: "asc" } },
      },
    });

    console.log("[listMyEvents] returned", events.length, "events");

    // Decorate and tag each event with the viewer's role
    const decorated = decorateEvents(events as any[]).map((ev: any) => {
      const ownerUserId =
        ev.business_promotion?.user_id ?? null;
      const isOwner = ownerUserId === userId;
      const staffRole = staffRoleMap.get(ev.id) ?? null;
      return {
        ...ev,
        viewer_role: isOwner ? "owner" : (staffRole ?? "viewer"),
      };
    });

    res.json(decorated);
  } catch (err) {
    console.error("[listMyEvents] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ─── Recurrence helpers ────────────────────────────────────────────────────

const DAY_MAP: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

/**
 * Generate occurrence dates for a recurring event.
 * Starts from the day AFTER baseDate, up to endsAt or maxOccurrences (default 52).
 */
function generateRecurringDates(
  baseDate: Date,
  rule: { freq: "weekly" | "monthly"; days?: string[]; interval?: number },
  endsAt: Date,
  maxOccurrences = 52,
): Date[] {
  const dates: Date[] = [];
  const interval = Math.max(1, rule.interval ?? 1);

  if (rule.freq === "weekly") {
    const targetDays = (rule.days ?? [])
      .map((d) => DAY_MAP[d.toUpperCase()])
      .filter((d) => d !== undefined) as number[];
    if (targetDays.length === 0) return dates;

    // Walk day by day starting from the day after the base event
    const current = new Date(baseDate);
    current.setDate(current.getDate() + 1);
    // track week start to apply interval correctly
    let weeksSinceBase = 0;
    let lastWeek = -1;

    while (current <= endsAt && dates.length < maxOccurrences) {
      const dow = current.getDay();
      // Which week number is this relative to base?
      const daysDiff = Math.floor((current.getTime() - baseDate.getTime()) / (86400000));
      const currentWeek = Math.floor(daysDiff / 7);

      if (currentWeek !== lastWeek) {
        weeksSinceBase = currentWeek;
        lastWeek = currentWeek;
      }

      // Only include days that fall on an interval week
      if (weeksSinceBase % interval === 0 && targetDays.includes(dow)) {
        dates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }
  } else if (rule.freq === "monthly") {
    const dayOfMonth = baseDate.getDate();
    const current = new Date(baseDate.getFullYear(), baseDate.getMonth() + interval, dayOfMonth);

    while (current <= endsAt && dates.length < maxOccurrences) {
      dates.push(new Date(current));
      current.setMonth(current.getMonth() + interval);
      // Correct for month overflow (e.g., Jan 31 + 1 month → Mar 3)
      current.setDate(dayOfMonth);
    }
  }

  return dates;
}

export async function createEvent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const {
    business_promotion_id,
    promotionId,
    title,
    description,
    date,
    end_date,
    time,
    location,
    image_url,
    ticket_price,
    max_attendees,
    company_logo,
    venue_images,
    recurrence_rule,
    recurrence_ends_at,
  } = req.body;

  console.log("[createEvent] body:", JSON.stringify(req.body));
  console.log(
    "[createEvent] user:",
    req.user?.userId,
    "roles:",
    req.user?.roles,
  );

  const rawPromotionId = business_promotion_id ?? promotionId;
  const promotionIdNum = rawPromotionId
    ? parseInt(String(rawPromotionId), 10)
    : NaN;
  if (!promotionIdNum || !title || !date || !time) {
    console.log(
      "[createEvent] validation failed — promotionId:",
      promotionIdNum,
      "title:",
      title,
      "date:",
      date,
      "time:",
      time,
    );
    res
      .status(400)
      .json({
        error: "business_promotion_id, title, date, and time are required",
      });
    return;
  }

  const promotion = await prisma.businessPromotion.findUnique({
    where: { id: promotionIdNum },
    select: {
      id: true,
      user_id: true,
      status: true,
      business_card_id: true,
      business_name: true,
    },
  });
  if (!promotion) {
    console.log("[createEvent] promotion not found for id:", promotionIdNum);
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  if (
    promotion.user_id !== req.user!.userId &&
    !req.user!.roles.includes("admin")
  ) {
    console.log(
      "[createEvent] forbidden — promotion.user_id:",
      promotion.user_id,
      "req.user.userId:",
      req.user!.userId,
    );
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (promotion.status !== "active" && promotion.status !== "draft") {
    console.log("[createEvent] promotion not active:", promotion.status);
    res
      .status(409)
      .json({ error: "Promotion must be active to create events" });
    return;
  }

  try {
    // Parse and validate recurrence_rule if provided
    let parsedRule: { freq: "weekly" | "monthly"; days?: string[]; interval?: number } | null = null;
    let recurrenceEndsAt: Date | null = null;

    if (recurrence_rule) {
      try {
        parsedRule = typeof recurrence_rule === "string" ? JSON.parse(recurrence_rule) : recurrence_rule;
        if (!parsedRule || !["weekly", "monthly"].includes(parsedRule.freq)) {
          res.status(400).json({ error: "Invalid recurrence_rule: freq must be 'weekly' or 'monthly'" });
          return;
        }
      } catch {
        res.status(400).json({ error: "Invalid recurrence_rule: must be valid JSON" });
        return;
      }
      if (!recurrence_ends_at) {
        res.status(400).json({ error: "recurrence_ends_at is required when recurrence_rule is set" });
        return;
      }
      recurrenceEndsAt = new Date(recurrence_ends_at);
      if (isNaN(recurrenceEndsAt.getTime())) {
        res.status(400).json({ error: "Invalid recurrence_ends_at date" });
        return;
      }
    }

    const event = await prisma.event.create({
      data: {
        business_promotion_id: promotion.id,
        business_id: promotion.business_card_id ?? null,
        title,
        description: description || null,
        date: new Date(date),
        end_date: end_date ? new Date(end_date) : null,
        time,
        location: location || null,
        image_url: image_url || null,
        ticket_price: ticket_price ? parseFloat(ticket_price) : null,
        max_attendees: max_attendees ? parseInt(max_attendees, 10) : null,
        status: "active",
        company_logo: company_logo || null,
        venue_images: Array.isArray(venue_images) ? venue_images : [],
        recurrence_rule: parsedRule ? JSON.stringify(parsedRule) : null,
        recurrence_ends_at: recurrenceEndsAt,
      },
      include: {
        business_promotion: {
          select: { id: true, business_name: true, business_card_id: true },
        },
        business: { select: { id: true, company_name: true } },
        ticket_tiers: { orderBy: { sort_order: "asc" } },
      },
    });
    console.log("[createEvent] success — event.id:", event.id);

    // Generate occurrence events if recurrence is set
    let occurrencesCreated = 0;
    if (parsedRule && recurrenceEndsAt) {
      const baseDate = new Date(date);
      const occurrenceDates = generateRecurringDates(baseDate, parsedRule, recurrenceEndsAt);
      console.log(`[createEvent] generating ${occurrenceDates.length} occurrences for parent event.id:`, event.id);

      for (const occDate of occurrenceDates) {
        await prisma.event.create({
          data: {
            business_promotion_id: promotion.id,
            business_id: promotion.business_card_id ?? null,
            title,
            description: description || null,
            date: occDate,
            time,
            location: location || null,
            image_url: image_url || null,
            ticket_price: ticket_price ? parseFloat(ticket_price) : null,
            max_attendees: max_attendees ? parseInt(max_attendees, 10) : null,
            status: "active",
            company_logo: company_logo || null,
            venue_images: Array.isArray(venue_images) ? venue_images : [],
            parent_event_id: event.id,
          },
        });
        occurrencesCreated++;
      }
      console.log(`[createEvent] created ${occurrencesCreated} occurrence events`);
    }

    res.status(201).json({ ...decorateEvent(event as any), occurrences_created: occurrencesCreated });
  } catch (err) {
    console.error("[createEvent] prisma error:", err);
    const detail = (err as any)?.message ?? String(err);
    res.status(500).json({ error: "Internal server error", detail });
  }
}

export async function updateEvent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const id = paramInt(req.params.id);
  console.log(
    "[updateEvent] id:",
    id,
    "userId:",
    req.user!.userId,
    "body:",
    JSON.stringify(req.body),
  );
  try {
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        business_promotion: { select: { user_id: true } },
        business: { select: { user_id: true } },
      },
    });
    if (!event) {
      console.log("[updateEvent] not found for id:", id);
      res.status(404).json({ error: "Not found" });
      return;
    }
    const ownerUserId =
      event.business_promotion?.user_id ?? event.business?.user_id ?? null;
    const isOwner = ownerUserId === req.user!.userId;
    const isAdmin = req.user!.roles.includes("admin");
    const isCoOrganizer =
      !isOwner && !isAdmin
        ? await canAccessEvent(id, req.user!.userId, ["co_organizer"])
        : false;
    if (!isOwner && !isAdmin && !isCoOrganizer) {
      console.log(
        "[updateEvent] forbidden — owner:",
        ownerUserId,
        "requester:",
        req.user!.userId,
      );
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const allowedFields = [
      "title",
      "description",
      "date",
      "end_date",
      "time",
      "location",
      "image_url",
      "ticket_price",
      "max_attendees",
      "status",
      "company_logo",
      "venue_images",
    ];
    const data: any = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        if (key === "date" || key === "end_date") data[key] = req.body[key] ? new Date(req.body[key]) : null;
        else if (key === "venue_images") data[key] = Array.isArray(req.body[key]) ? req.body[key] : [];
        else if (key === "ticket_price") data[key] = parseFloat(req.body[key]);
        else if (key === "max_attendees")
          data[key] = parseInt(req.body[key], 10);
        else data[key] = req.body[key];
      }
    }
    console.log("[updateEvent] applying data:", JSON.stringify(data));

    // Capture old max_attendees before updating so we can detect a capacity increase.
    const oldMaxAttendees = event.max_attendees;

    const updated = await prisma.event.update({
      where: { id },
      data,
      include: { ticket_tiers: { orderBy: { sort_order: "asc" } } },
    });
    console.log("[updateEvent] success — event:", updated.id, updated.title);
    res.json(decorateEvent(updated as any));

    // After responding, check if capacity was increased and notify waitlisted users.
    // Only fire when max_attendees grew AND there is now free capacity.
    const newMaxAttendees = updated.max_attendees;
    const capacityIncreased =
      newMaxAttendees !== null &&
      (oldMaxAttendees === null || newMaxAttendees > oldMaxAttendees) &&
      updated.attendee_count < newMaxAttendees;

    if (capacityIncreased) {
      try {
        const waitlisted = await prisma.eventWaitlist.findMany({
          where: { event_id: id, status: "waiting" },
          select: { user_id: true },
        });

        if (waitlisted.length > 0) {
          const userIds = waitlisted.map((w) => w.user_id);
          const users = await prisma.user.findMany({
            where: { id: { in: userIds }, push_token: { not: null } },
            select: { id: true, push_token: true },
          });

          const io = getIO();
          for (const u of users) {
            if (io) {
              io.to(`user:${u.id}`).emit("event:tickets_available", {
                type: "event:tickets_available",
                eventId: id,
                eventTitle: updated.title,
              });
            }
            await notify({
              pushToken: u.push_token,
              userId: u.id,
              title: "🎟️ Tickets Are Live!",
              body: `Tickets are available again for "${updated.title}"! You're on the waitlist — register now before they sell out!`,
              type: "event_tickets_available",
              data: { screen: "Events", eventId: id },
            });
          }
          console.log(
            `[updateEvent] notified ${users.length} waitlisted user(s) of new capacity for event ${id}`,
          );
        }
      } catch (notifyErr) {
        console.error("[updateEvent] waitlist notify ERROR:", notifyErr);
        /* non-blocking — do not re-throw */
      }
    }
  } catch (err) {
    console.error("[updateEvent] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function registerForEvent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const { ticket_count, payment, tier_id } = req.body;
  const tierIdNum = parseOptionalId(tier_id);

  // ────────────────────────────────────────────────────────────────────
  // Phase 3 — Tier-aware register flow.
  // Only triggered when caller passed `tier_id`. Otherwise we fall through
  // to the EXISTING legacy logic below — left 100% untouched.
  // ────────────────────────────────────────────────────────────────────
  if (tierIdNum) {
    await registerForEventWithTier(req, res, eventId, tierIdNum);
    return;
  }

  console.log(
    "[registerForEvent] eventId:",
    eventId,
    "userId:",
    req.user!.userId,
    "ticket_count:",
    ticket_count,
    "hasPayment:",
    !!payment,
  );
  if (payment) {
    console.log(
      "[registerForEvent] payment — order:",
      payment.razorpay_order_id,
      "paymentId:",
      payment.razorpay_payment_id,
    );
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    console.log("[registerForEvent] event not found:", eventId);
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (event.status !== "active") {
    console.log("[registerForEvent] event not active:", event.status);
    res.status(400).json({ error: "Event is not active" });
    return;
  }
  console.log(
    "[registerForEvent] event found:",
    event.title,
    "price:",
    event.ticket_price,
    "attendees:",
    event.attendee_count,
    "/",
    event.max_attendees,
  );

  const count = parseTicketCount(ticket_count);

  if (
    event.max_attendees &&
    event.attendee_count + count > event.max_attendees
  ) {
    res.status(400).json({ error: "Event is full" });
    return;
  }

  const existing = await prisma.eventRegistration.findFirst({
    where: { event_id: eventId, user_id: req.user!.userId },
  });
  if (existing) {
    console.log("[registerForEvent] already registered — regId:", existing.id);
    res
      .status(409)
      .json({ error: "Already registered", registration: existing });
    return;
  }

  const isPaidEvent = !!event.ticket_price && event.ticket_price > 0;
  let paymentStatus = "not_required";
  let paymentOrderId: string | null = null;
  let paymentId: string | null = null;
  let paymentSignature: string | null = null;
  let amountPaid: number | null = null;

  if (isPaidEvent) {
    const razorpayOrderId = payment?.razorpay_order_id;
    const razorpayPaymentId = payment?.razorpay_payment_id;
    const razorpaySignature = payment?.razorpay_signature;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res
        .status(400)
        .json({ error: "Payment details are required for paid events" });
      return;
    }

    const signatureOk = verifyRazorpaySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });
    console.log(
      "[registerForEvent] signature verification:",
      signatureOk ? "PASS" : "FAIL",
    );
    if (!signatureOk) {
      console.log(
        "[registerForEvent] REJECTED — invalid payment signature for order:",
        razorpayOrderId,
      );
      res.status(400).json({ error: "Invalid payment signature" });
      return;
    }

    const duplicatePayment = await prisma.eventRegistration.findFirst({
      where: { payment_id: razorpayPaymentId },
      select: { id: true },
    });
    if (duplicatePayment) {
      console.log(
        "[registerForEvent] REJECTED — duplicate payment_id:",
        razorpayPaymentId,
        "used in reg:",
        duplicatePayment.id,
      );
      res
        .status(409)
        .json({ error: "Payment already used for another registration" });
      return;
    }

    const expectedAmountPaise = calculateTicketAmountPaise(
      event.ticket_price!,
      count,
    );

    try {
      const order = await fetchRazorpayOrder(razorpayOrderId);
      console.log(
        "[registerForEvent] razorpay order amount:",
        order.amount,
        "expected:",
        expectedAmountPaise,
      );
      if (order.amount !== expectedAmountPaise) {
        console.log(
          "[registerForEvent] REJECTED — amount mismatch — order:",
          order.amount,
          "expected:",
          expectedAmountPaise,
        );
        res.status(400).json({ error: "Payment amount mismatch" });
        return;
      }

      paymentStatus = "paid";
      paymentOrderId = razorpayOrderId;
      paymentId = razorpayPaymentId;
      paymentSignature = razorpaySignature;
      amountPaid = expectedAmountPaise / 100;
      console.log(
        "[registerForEvent] payment verified — amount:",
        amountPaid,
        "INR",
      );
    } catch (_err) {
      console.error("[registerForEvent] ERROR fetching razorpay order:", _err);
      res
        .status(502)
        .json({ error: "Unable to verify payment order with provider" });
      return;
    }
  }

  const qrCode = `EVT-${eventId}-${crypto.randomBytes(6).toString("hex")}`;

  const [registration] = await prisma.$transaction([
    prisma.eventRegistration.create({
      data: {
        event_id: eventId,
        user_id: req.user!.userId,
        ticket_count: count,
        qr_code: qrCode,
        payment_status: paymentStatus,
        payment_order_id: paymentOrderId,
        payment_id: paymentId,
        payment_signature: paymentSignature,
        amount_paid: amountPaid,
      },
    }),
    prisma.event.update({
      where: { id: eventId },
      data: { attendee_count: { increment: count } },
    }),
  ]);

  console.log(
    "[registerForEvent] SUCCESS — regId:",
    registration.id,
    "qrCode:",
    qrCode,
    "paymentStatus:",
    paymentStatus,
  );
  logger.info("EVENT_REGISTRATION_SUCCESS", {
    userId: req.user!.userId,
    eventId,
    registrationId: registration.id,
    ticketCount: count,
    paymentStatus,
    legacy: true,
  });

  await notifyRegistrantRegistrationSuccess({
    userId: req.user!.userId,
    eventId,
    eventTitle: event.title,
    ticketCount: count,
    paymentStatus,
  });

  // Notify event organizer in real-time
  try {
    const eventWithBiz = await prisma.event.findUnique({
      where: { id: eventId },
      include: { business: { select: { user_id: true } } },
    });
    if (eventWithBiz && eventWithBiz.business) {
      const organizer = await prisma.user.findUnique({
        where: { id: eventWithBiz.business.user_id },
        select: { id: true, push_token: true },
      });
      const attendee = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { name: true },
      });
      if (organizer && organizer.id !== req.user!.userId) {
        const io = getIO();
        const payload = {
          type: "event:registered",
          eventId,
          eventTitle: event.title,
          attendeeName: attendee?.name ?? "Someone",
          ticketCount: count,
        };
        if (io) io.to(`user:${organizer.id}`).emit("event:registered", payload);
        await notify({
          pushToken: organizer.push_token,
          userId: organizer.id,
          title: "New Event Registration",
          body: `${attendee?.name ?? "Someone"} registered for "${event.title}"`,
          type: "event_new_registration",
          data: { screen: "Events" },
        });
      }
    }
  } catch {
    /* non-blocking */
  }

  res.status(201).json({ ...registration, qr_code: qrCode });
}

export async function createEventPaymentIntent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const count = parseTicketCount(req.body?.ticket_count);
  const tierIdNum = parseOptionalId(req.body?.tier_id);

  // Phase 3 — tier-aware intent. Falls through to legacy path when no tier.
  if (tierIdNum) {
    await createTierPaymentIntent(req, res, eventId, tierIdNum, count);
    return;
  }

  console.log(
    "[createPaymentIntent] eventId:",
    eventId,
    "userId:",
    req.user!.userId,
    "ticketCount:",
    count,
  );

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    console.log("[createPaymentIntent] event not found:", eventId);
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (event.status !== "active") {
    console.log("[createPaymentIntent] event not active:", event.status);
    res.status(400).json({ error: "Event is not active" });
    return;
  }
  console.log(
    "[createPaymentIntent] event:",
    event.title,
    "price:",
    event.ticket_price,
    "attendees:",
    event.attendee_count,
    "/",
    event.max_attendees,
  );
  if (!event.ticket_price || event.ticket_price <= 0) {
    res.status(400).json({ error: "Payment is not required for this event" });
    return;
  }

  if (
    event.max_attendees &&
    event.attendee_count + count > event.max_attendees
  ) {
    res.status(400).json({ error: "Event is full" });
    return;
  }

  const existing = await prisma.eventRegistration.findFirst({
    where: { event_id: eventId, user_id: req.user!.userId },
    select: { id: true },
  });
  if (existing) {
    res.status(409).json({ error: "Already registered" });
    return;
  }

  const amountPaise = calculateTicketAmountPaise(event.ticket_price, count);
  const receipt = `evt_${eventId}_usr_${req.user!.userId}_${Date.now()}`.slice(
    0,
    40,
  );

  console.log(
    "[createPaymentIntent] creating razorpay order — amountPaise:",
    amountPaise,
    "receipt:",
    receipt,
  );
  try {
    const order = await createRazorpayOrder({
      amountPaise,
      currency: "INR",
      receipt,
      notes: {
        event_id: String(eventId),
        user_id: String(req.user!.userId),
        ticket_count: String(count),
      },
    });
    console.log(
      "[createPaymentIntent] SUCCESS — orderId:",
      order.id,
      "amount:",
      order.amount,
    );

    res.status(201).json({
      key_id: getRazorpayPublicKey(),
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      event_id: eventId,
      event_title: event.title,
      ticket_count: count,
      unit_price: event.ticket_price,
    });
  } catch (_err) {
    console.error("[createPaymentIntent] ERROR creating razorpay order:", _err);
    res.status(502).json({ error: "Unable to create payment order" });
  }
}

export async function getEventRegistrations(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  console.log(
    "[getEventRegistrations] eventId:",
    eventId,
    "userId:",
    req.user!.userId,
  );

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        business_promotion: { select: { user_id: true } },
        business: { select: { user_id: true } },
      },
    });
    if (!event) {
      console.log("[getEventRegistrations] event not found:", eventId);
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const ownerUserId =
      event.business_promotion?.user_id ?? event.business?.user_id ?? null;
    if (
      ownerUserId !== req.user!.userId &&
      !req.user!.roles.includes("admin")
    ) {
      console.log(
        "[getEventRegistrations] forbidden — owner:",
        ownerUserId,
        "requester:",
        req.user!.userId,
      );
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const registrations = await prisma.eventRegistration.findMany({
      where: { event_id: eventId },
      include: {
        user: {
          select: { id: true, name: true, phone: true, profile_picture: true },
        },
      },
      orderBy: { registered_at: "desc" },
    });
    console.log(
      "[getEventRegistrations] returned",
      registrations.length,
      "registrations for event:",
      eventId,
    );
    res.json(registrations);
  } catch (err) {
    console.error("[getEventRegistrations] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getMyRegistrations(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  console.log("[getMyRegistrations] userId:", req.user!.userId);
  try {
    const registrations = await prisma.eventRegistration.findMany({
      where: { user_id: req.user!.userId },
      include: { event: true, ticket_tier: true },
      orderBy: { registered_at: "desc" },
    });
    console.log(
      "[getMyRegistrations] returned",
      registrations.length,
      "registrations",
    );
    res.json(registrations);
  } catch (err) {
    console.error("[getMyRegistrations] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function verifyRegistration(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const { qr_code } = req.body;
  console.log(
    "[verifyRegistration] qr_code:",
    qr_code,
    "userId:",
    req.user!.userId,
  );
  if (!qr_code || typeof qr_code !== "string") {
    console.log("[verifyRegistration] REJECTED — missing qr_code");
    res.status(400).json({ error: "qr_code is required" });
    return;
  }

  try {
    const registration = await prisma.eventRegistration.findFirst({
      where: { qr_code },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            date: true,
            time: true,
            location: true,
            business_id: true,
          },
        },
        user: {
          select: { id: true, name: true, phone: true, profile_picture: true },
        },
      },
    }) as any;

    if (!registration) {
      console.log("[verifyRegistration] not found for qr_code:", qr_code);
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    console.log(
      "[verifyRegistration] found reg:",
      registration.id,
      "event:",
      registration.event?.title,
      "user:",
      registration.user?.name,
    );

    // Allow event owner, admin, co-organizer, or scanner to verify
    const event = await prisma.event.findUnique({
      where: { id: registration.event_id },
      include: {
        business_promotion: { select: { user_id: true } },
        business: { select: { user_id: true } },
      },
    });
    const ownerUserId =
      event?.business_promotion?.user_id ?? event?.business?.user_id ?? null;
    const isOwnerOrAdmin =
      ownerUserId === req.user!.userId || req.user!.roles.includes("admin");
    const isStaff = event
      ? await canAccessEvent(registration.event_id, req.user!.userId, ["co_organizer", "scanner"])
      : false;
    if (event && !isOwnerOrAdmin && !isStaff) {
      console.log(
        "[verifyRegistration] forbidden — owner:",
        ownerUserId,
        "requester:",
        req.user!.userId,
      );
      res.status(403).json({
        error: "Only the event organizer, staff, or admin can verify registrations",
      });
      return;
    }

    console.log(
      "[verifyRegistration] SUCCESS — regId:",
      registration.id,
      "paymentStatus:",
      registration.payment_status,
    );

    // ── Phase 5: Check-in handling ─────────────────────────────────
    // First successful scan: flip checked_in fields. Repeat scans return
    // already_used=true. Refunded / cancelled regs are rejected.
    if (registration.refund_status === "refunded" || registration.cancelled_at) {
      res.status(410).json({
        error: "Registration is cancelled or refunded",
        code: "REGISTRATION_CANCELLED",
        registration_id: registration.id,
      });
      return;
    }

    let alreadyUsed = false;
    let checkedInAt: Date | null = registration.checked_in_at ?? null;
    let checkedInBy: number | null = registration.checked_in_by ?? null;
    if (registration.checked_in) {
      alreadyUsed = true;
      console.log(
        "[verifyRegistration] ALREADY_USED — regId:",
        registration.id,
        "checked_in_at:",
        registration.checked_in_at,
      );
    } else {
      // Atomic flip: only update if checked_in is still false. Stops two
      // organizers double-scanning the same QR from both succeeding.
      const updated: number = await prisma.$executeRaw(
        Prisma.sql`UPDATE "EventRegistration"
                   SET "checked_in"    = true,
                       "checked_in_at" = NOW(),
                       "checked_in_by" = ${req.user!.userId}
                   WHERE "id" = ${registration.id}
                     AND "checked_in" = false`,
      );
      if (updated === 0) {
        // Lost the race — re-read to return the canonical timestamp.
        const fresh = await prisma.eventRegistration.findUnique({
          where: { id: registration.id },
          select: { checked_in_at: true, checked_in_by: true },
        });
        alreadyUsed = true;
        checkedInAt = fresh?.checked_in_at ?? null;
        checkedInBy = fresh?.checked_in_by ?? null;
      } else {
        checkedInAt = new Date();
        checkedInBy = req.user!.userId;
        console.log(
          "[verifyRegistration] CHECKED_IN — regId:",
          registration.id,
          "by:",
          req.user!.userId,
        );
        // Notify the ticket holder they have been checked in
        try {
          const ticketHolder = await prisma.user.findUnique({
            where: { id: registration.user_id },
            select: { push_token: true },
          });
          if (ticketHolder) {
            const eventTitle = registration.event?.title ?? "the event";
            await notify({
              userId: registration.user_id,
              pushToken: ticketHolder.push_token ?? undefined,
              title: "✅ You're Checked In!",
              body: `Your ticket for "${eventTitle}" has been scanned. Enjoy the event!`,
              type: "EVENT_CHECKIN",
            });
          }
          // Real-time socket push so the mobile UI updates instantly
          getIO()?.to(`user:${registration.user_id}`).emit("event:checkin", {
            registrationId: registration.id,
            eventId: registration.event_id,
            eventName: registration.event?.title ?? null,
          });
        } catch (notifyErr) {
          console.error("[verifyRegistration] check-in notify failed:", notifyErr);
        }
      }
    }

    res.json({
      registration_id: registration.id,
      qr_code: registration.qr_code,
      ticket_count: registration.ticket_count,
      cancelled_count: (registration as any).cancelled_count ?? 0,
      active_tickets: registration.ticket_count - ((registration as any).cancelled_count ?? 0),
      payment_status: registration.payment_status,
      amount_paid: registration.amount_paid,
      registered_at: registration.registered_at,
      user: registration.user,
      event: registration.event,
      // Phase 5 — check-in fields (additive, backward-compat)
      checked_in: true,
      checked_in_at: checkedInAt,
      checked_in_by: checkedInBy,
      already_used: alreadyUsed,
    });
  } catch (err) {
    console.error("[verifyRegistration] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ════════════════════════════════════════════════════════════════════════
// Phase 3 — Tier-aware payment intent + register
// ════════════════════════════════════════════════════════════════════════

/**
 * Tier-aware payment intent.
 * - Validates the tier exists, belongs to the event, is active and on sale.
 * - Soft capacity pre-check (tier + event). Hard check happens atomically
 *   inside the register transaction.
 * - amount = tier.price * ticket_count
 */
async function createTierPaymentIntent(
  req: AuthRequest,
  res: Response,
  eventId: number,
  tierId: number,
  countRaw: number,
): Promise<void> {
  // ── Defensive: strict count validation (rejects NaN, non-int, <=0, >100)
  const strictCount = parseStrictTicketCount(req.body?.ticket_count);
  if (strictCount === null) {
    res.status(400).json({ error: "Invalid ticket_count" });
    return;
  }
  const count = strictCount;
  void countRaw; // legacy param kept for signature stability

  console.log(
    "[createPaymentIntent.tier] eventId:",
    eventId,
    "tierId:",
    tierId,
    "userId:",
    req.user!.userId,
    "count:",
    count,
  );

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { ticket_tiers: { where: { id: tierId } } },
  });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  // Hard event-status gate
  if (event.status !== "active" || event.cancelled_at) {
    res.status(400).json({ error: "Event is not active" });
    return;
  }
  if (event.is_legacy) {
    res.status(400).json({
      error:
        "This event does not support ticket tiers. Use the legacy register flow.",
    });
    return;
  }

  const tier = event.ticket_tiers[0];
  if (!tier || tier.event_id !== eventId) {
    res.status(404).json({ error: "Ticket tier not found" });
    return;
  }
  if (!tier.is_active) {
    res.status(400).json({ error: "Ticket tier is not active" });
    return;
  }

  const now = new Date();
  if (tier.sale_starts_at && now < tier.sale_starts_at) {
    res.status(400).json({ error: "Ticket sale has not started" });
    return;
  }
  if (tier.sale_ends_at && now > tier.sale_ends_at) {
    res.status(400).json({ error: "Ticket sale has ended" });
    return;
  }
  if (count < tier.min_per_order) {
    res.status(400).json({
      error: `Minimum ${tier.min_per_order} tickets per order for this tier`,
    });
    return;
  }
  if (count > tier.max_per_order) {
    res.status(400).json({
      error: `Maximum ${tier.max_per_order} tickets per order for this tier`,
    });
    return;
  }

  // Soft capacity pre-checks (atomic guard still runs at register time)
  if (
    tier.quantity_total !== null &&
    tier.quantity_sold + count > tier.quantity_total
  ) {
    logger.warn("EVENT_REGISTRATION_FAILED", {
      code: "TIER_SOLD_OUT",
      userId: req.user?.userId,
      eventId,
      tierId: tier.id,
      count,
    });
    res.status(409).json({ error: "Tier sold out", code: "TIER_SOLD_OUT" });
    return;
  }
  if (
    event.max_attendees &&
    event.attendee_count + count > event.max_attendees
  ) {
    logger.warn("EVENT_REGISTRATION_FAILED", {
      code: "EVENT_FULL",
      userId: req.user?.userId,
      eventId,
      tierId: tier.id,
      count,
    });
    res.status(409).json({ error: "Event is full", code: "EVENT_FULL" });
    return;
  }

  // Duplicate registration guard (per-user per-event)
  const existing = await prisma.eventRegistration.findFirst({
    where: { event_id: eventId, user_id: req.user!.userId },
    select: { id: true },
  });
  if (existing) {
    res.status(409).json({ error: "Already registered" });
    return;
  }

  const unitPrice = Number(tier.price ?? 0) || 0;
  // Free tier: payment intent is meaningless — caller should call /register directly.
  if (unitPrice <= 0) {
    res.status(400).json({
      error: "Payment is not required for this tier",
      code: "FREE_TIER",
    });
    return;
  }

  const amountPaise = Math.round(unitPrice * 100) * count;
  const receipt = `evt_${eventId}_t${tierId}_u${req.user!.userId}_${Date.now()}`.slice(
    0,
    40,
  );

  try {
    const order = await createRazorpayOrder({
      amountPaise,
      currency: tier.currency || "INR",
      receipt,
      notes: {
        event_id: String(eventId),
        user_id: String(req.user!.userId),
        tier_id: String(tierId),
        ticket_count: String(count),
      },
    });
    console.log(
      "[createPaymentIntent.tier] SUCCESS — orderId:",
      order.id,
      "amount:",
      order.amount,
    );
    res.status(201).json({
      key_id: getRazorpayPublicKey(),
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      event_id: eventId,
      event_title: event.title,
      ticket_count: count,
      unit_price: unitPrice,
      tier_id: tierId,
      tier_name: tier.name,
    });
  } catch (err) {
    console.error("[createPaymentIntent.tier] ERROR:", err);
    res.status(502).json({ error: "Unable to create payment order" });
  }
}

/**
 * Tier-aware register flow.
 *
 * Hard guarantees:
 *   • Capacity check + increment for BOTH the tier and the event happen
 *     INSIDE a single $transaction using conditional UPDATE statements
 *     ("UPDATE … WHERE quantity_sold + N <= quantity_total"). If the WHERE
 *     fails, the row count is 0 → we throw → tx rolls back. This eliminates
 *     the read-then-write race.
 *   • Payment signature is verified BEFORE the transaction. Razorpay order
 *     amount is re-fetched and compared against `tier.price * count`.
 *   • Per-user duplicate guarded outside tx; per-payment_id duplicate
 *     guarded outside tx (DB also has a unique-ish index for safety).
 */
async function registerForEventWithTier(
  req: AuthRequest,
  res: Response,
  eventId: number,
  tierId: number,
): Promise<void> {
  const { ticket_count, payment } = req.body;

  // ── Defensive count validation (rejects undefined, NaN, non-int, <=0, >100)
  const strictCount = parseStrictTicketCount(ticket_count);
  if (strictCount === null) {
    res.status(400).json({ error: "Invalid ticket_count" });
    return;
  }
  const count = strictCount;
  const userId = req.user!.userId;

  console.log(
    "[registerForEvent.tier] eventId:",
    eventId,
    "tierId:",
    tierId,
    "userId:",
    userId,
    "count:",
    count,
    "hasPayment:",
    !!payment,
  );

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { ticket_tiers: { where: { id: tierId } } },
  });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  // Hard event-status gate
  if (event.status !== "active" || event.cancelled_at) {
    res.status(400).json({ error: "Event is not active" });
    return;
  }
  if (event.is_legacy) {
    res.status(400).json({
      error:
        "This event does not support ticket tiers. Use the legacy register flow.",
    });
    return;
  }
  const tier = event.ticket_tiers[0];
  if (!tier || tier.event_id !== eventId) {
    res.status(404).json({ error: "Ticket tier not found" });
    return;
  }
  if (!tier.is_active) {
    res.status(400).json({ error: "Ticket tier is not active" });
    return;
  }

  const now = new Date();
  if (tier.sale_starts_at && now < tier.sale_starts_at) {
    res.status(400).json({ error: "Ticket sale has not started" });
    return;
  }
  if (tier.sale_ends_at && now > tier.sale_ends_at) {
    res.status(400).json({ error: "Ticket sale has ended" });
    return;
  }
  if (count < tier.min_per_order) {
    res.status(400).json({
      error: `Minimum ${tier.min_per_order} tickets per order for this tier`,
    });
    return;
  }
  if (count > tier.max_per_order) {
    res.status(400).json({
      error: `Maximum ${tier.max_per_order} tickets per order for this tier`,
    });
    return;
  }

  // Per-user duplicate registration (also enforced by DB unique index)
  const existing = await prisma.eventRegistration.findFirst({
    where: { event_id: eventId, user_id: userId },
    select: { id: true },
  });
  if (existing) {
    res
      .status(409)
      .json({ error: "Already registered", registration: existing });
    return;
  }

  const unitPrice = Number(tier.price ?? 0) || 0;
  const isPaid = unitPrice > 0;
  let paymentStatus: string = "not_required";
  let paymentOrderId: string | null = null;
  let paymentId: string | null = null;
  let paymentSignature: string | null = null;
  let amountPaid: number | null = null;

  if (isPaid) {
    const razorpayOrderId = payment?.razorpay_order_id;
    const razorpayPaymentId = payment?.razorpay_payment_id;
    const razorpaySignature = payment?.razorpay_signature;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res
        .status(400)
        .json({ error: "Payment details are required for paid tiers" });
      return;
    }
    const sigOk = verifyRazorpaySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });
    if (!sigOk) {
      res.status(400).json({ error: "Invalid payment signature" });
      return;
    }
    // Duplicate payment_id guard
    const dupPay = await prisma.eventRegistration.findFirst({
      where: { payment_id: razorpayPaymentId },
      select: { id: true },
    });
    if (dupPay) {
      res
        .status(409)
        .json({ error: "Payment already used for another registration" });
      return;
    }
    // Order-id reuse guard — same order_id must not appear elsewhere
    // (different user / different event / different registration entirely).
    const dupOrder = await prisma.eventRegistration.findFirst({
      where: { payment_order_id: razorpayOrderId },
      select: { id: true, user_id: true, event_id: true },
    });
    if (dupOrder) {
      res.status(409).json({
        error: "Payment order already used for another registration",
        code: "ORDER_ID_REUSED",
      });
      return;
    }
    const expectedPaise = Math.round(unitPrice * 100) * count;
    try {
      const order = await fetchRazorpayOrder(razorpayOrderId);
      if (order.amount !== expectedPaise) {
        res.status(400).json({ error: "Payment amount mismatch" });
        return;
      }
      paymentStatus = "paid";
      paymentOrderId = razorpayOrderId;
      paymentId = razorpayPaymentId;
      paymentSignature = razorpaySignature;
      amountPaid = expectedPaise / 100;
    } catch (err) {
      console.error("[registerForEvent.tier] razorpay fetch ERROR:", err);
      res
        .status(502)
        .json({ error: "Unable to verify payment order with provider" });
      return;
    }
  }
  // Else: free tier — payment_* fields stay null, payment_status = "not_required"
  // No payment validation runs.

  const qrCode = `EVT-${eventId}-${crypto.randomBytes(6).toString("hex")}`;

  // ───────── ATOMIC TRANSACTION ─────────
  let registrationId: number;
  try {
    registrationId = await prisma.$transaction(async (tx) => {
      // 1. Atomic tier increment (capacity-respecting). If the WHERE fails
      //    affectedRows = 0 → throw → entire tx rolls back.
      const tierRows: number = await tx.$executeRaw(
        Prisma.sql`UPDATE "EventTicketTier"
                   SET "quantity_sold" = "quantity_sold" + ${count},
                       "updated_at"    = NOW()
                   WHERE "id" = ${tierId}
                     AND "is_active" = true
                     AND ("quantity_total" IS NULL
                          OR "quantity_sold" + ${count} <= "quantity_total")`,
      );
      if (tierRows === 0) {
        const err: any = new Error("Tier sold out");
        err.http = 409;
        err.code = "TIER_SOLD_OUT";
        throw err;
      }

      // 2. Atomic event capacity increment.
      const eventRows: number = await tx.$executeRaw(
        Prisma.sql`UPDATE "Event"
                   SET "attendee_count" = "attendee_count" + ${count}
                   WHERE "id" = ${eventId}
                     AND "status" = 'active'
                     AND "cancelled_at" IS NULL
                     AND ("max_attendees" IS NULL
                          OR "attendee_count" + ${count} <= "max_attendees")`,
      );
      if (eventRows === 0) {
        const err: any = new Error("Event capacity reached");
        err.http = 409;
        err.code = "EVENT_FULL";
        throw err;
      }

      // 3. Create the registration row. DB unique constraint
      //    (user_id, event_id) catches concurrent duplicate inserts that
      //    slipped past the pre-tx findFirst check.
      try {
        const reg = await tx.eventRegistration.create({
          data: {
            event_id: eventId,
            user_id: userId,
            ticket_tier_id: tierId,
            ticket_count: count,
            qr_code: qrCode,
            payment_status: paymentStatus,
            payment_order_id: paymentOrderId,
            payment_id: paymentId,
            payment_signature: paymentSignature,
            amount_paid: amountPaid,
          },
        });
        return reg.id;
      } catch (e: any) {
        // P2002 = Prisma unique constraint violation
        if (e?.code === "P2002") {
          const err: any = new Error("User already registered for this event");
          err.http = 409;
          err.code = "DUPLICATE_REGISTRATION";
          throw err;
        }
        throw e;
      }
    });
  } catch (err: any) {
    const code = err?.http;
    if (code === 409) {
      console.log(
        "[registerForEvent.tier] tx-reject:",
        err.code,
        "user:",
        userId,
        "event:",
        eventId,
        "tier:",
        tierId,
        "count:",
        count,
      );
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[registerForEvent.tier] tx ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  console.log(
    "[registerForEvent.tier] SUCCESS — regId:",
    registrationId,
    "qr:",
    qrCode,
    "tier:",
    tierId,
  );
  logger.info("EVENT_REGISTRATION_SUCCESS", {
    userId,
    eventId,
    registrationId,
    tierId,
    ticketCount: count,
    legacy: false,
  });

  await notifyRegistrantRegistrationSuccess({
    userId,
    eventId,
    eventTitle: event.title,
    ticketCount: count,
    paymentStatus,
    tierName: tier.name,
  });

  // Notify organizer (best-effort, non-blocking)
  try {
    const eventWithBiz = await prisma.event.findUnique({
      where: { id: eventId },
      include: { business: { select: { user_id: true } } },
    });
    if (eventWithBiz && eventWithBiz.business) {
      const organizer = await prisma.user.findUnique({
        where: { id: eventWithBiz.business.user_id },
        select: { id: true, push_token: true },
      });
      const attendee = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      if (organizer && organizer.id !== userId) {
        const io = getIO();
        const payload = {
          type: "event:registered",
          eventId,
          eventTitle: event.title,
          attendeeName: attendee?.name ?? "Someone",
          ticketCount: count,
          tierName: tier.name,
        };
        if (io) io.to(`user:${organizer.id}`).emit("event:registered", payload);
        await notify({
          pushToken: organizer.push_token,
          userId: organizer.id,
          title: "New Event Registration",
          body: `${attendee?.name ?? "Someone"} registered (${tier.name}) for "${event.title}"`,
          type: "event_new_registration",
          data: { screen: "Events" },
        });
      }
    }
  } catch {
    /* non-blocking */
  }

  // Read the canonical row back so the client gets the persisted values.
  const registration = await prisma.eventRegistration.findUnique({
    where: { id: registrationId },
    include: { ticket_tier: true },
  });

  // Flat envelope — matches legacy registerForEvent shape so the client
  // can use a single transformResponse for both flows.
  res.status(201).json({ ...registration, qr_code: qrCode });
}

// ════════════════════════════════════════════════════════════════════════
// Multi-tier cart checkout
// ════════════════════════════════════════════════════════════════════════

/**
 * Create a single Razorpay order for a cart containing items from multiple
 * ticket tiers (e.g. 4 VIP + 2 General). Amount = sum of tier.price * qty
 * for all items.
 *
 * Body: { items: Array<{ tier_id: number; ticket_count: number }> }
 */
export async function createCartPaymentIntent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items must be a non-empty array" });
    return;
  }

  const tierIds: number[] = [];
  for (const item of items) {
    const tierId = Number(item.tier_id);
    const count = parseStrictTicketCount(item.ticket_count);
    if (!tierId || !count) {
      res.status(400).json({ error: "Each item needs a valid tier_id and ticket_count" });
      return;
    }
    tierIds.push(tierId);
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { ticket_tiers: { where: { id: { in: tierIds } } } },
  });
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  if (event.status !== "active" || event.cancelled_at) {
    res.status(400).json({ error: "Event is not active" }); return;
  }

  let totalPaise = 0;
  const orderItems: Array<{ tier_id: number; tier_name: string; ticket_count: number; unit_price: number }> = [];

  for (const item of items) {
    const tierId = Number(item.tier_id);
    const count = parseStrictTicketCount(item.ticket_count)!;
    const tier = event.ticket_tiers.find((t) => t.id === tierId);
    if (!tier) { res.status(404).json({ error: `Tier ${tierId} not found` }); return; }
    if (!tier.is_active) { res.status(400).json({ error: `Tier "${tier.name}" is not active` }); return; }
    const unitPrice = Number(tier.price ?? 0) || 0;
    totalPaise += Math.round(unitPrice * 100) * count;
    orderItems.push({ tier_id: tierId, tier_name: tier.name, ticket_count: count, unit_price: unitPrice });
  }

  if (totalPaise === 0) {
    res.status(400).json({ error: "All selected tiers are free — no payment required", code: "FREE_CART" });
    return;
  }

  const receipt = `evt_${eventId}_cart_u${req.user!.userId}_${Date.now()}`.slice(0, 40);
  try {
    const order = await createRazorpayOrder({
      amountPaise: totalPaise,
      currency: "INR",
      receipt,
      notes: {
        event_id: String(eventId),
        user_id: String(req.user!.userId),
        cart: JSON.stringify(items),
      },
    });
    res.status(201).json({
      key_id: getRazorpayPublicKey(),
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      event_id: eventId,
      event_title: event.title,
      items: orderItems,
    });
  } catch (err) {
    console.error("[createCartPaymentIntent] ERROR:", err);
    res.status(502).json({ error: "Unable to create payment order" });
  }
}

/**
 * Register for multiple ticket tiers of the same event in one atomic
 * transaction. Creates one EventRegistration row per cart item.
 *
 * Body: {
 *   items: Array<{ tier_id: number; ticket_count: number }>,
 *   payment?: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * }
 */
export async function registerCartItems(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const { items, payment } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items must be a non-empty array" });
    return;
  }

  const userId = req.user!.userId;
  const tierIds: number[] = items.map((i: any) => Number(i.tier_id));

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { ticket_tiers: { where: { id: { in: tierIds } } } },
  });
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  if (event.status !== "active" || event.cancelled_at) {
    res.status(400).json({ error: "Event is not active" }); return;
  }

  // Validate items + build work list
  let totalAmount = 0;
  let allFree = true;
  const workItems: Array<{ tier: any; count: number; unitPrice: number }> = [];

  for (const item of items) {
    const tierId = Number(item.tier_id);
    const count = parseStrictTicketCount(item.ticket_count);
    if (!count) { res.status(400).json({ error: `Invalid ticket_count for tier ${tierId}` }); return; }
    const tier = event.ticket_tiers.find((t) => t.id === tierId);
    if (!tier) { res.status(404).json({ error: `Tier ${tierId} not found` }); return; }
    if (!tier.is_active) { res.status(400).json({ error: `Tier "${tier.name}" is not active` }); return; }

    // Check not already registered for this specific tier
    const existing = await prisma.eventRegistration.findFirst({
      where: { event_id: eventId, user_id: userId, ticket_tier_id: tierId },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ error: `Already registered for "${tier.name}"`, code: "ALREADY_REGISTERED" });
      return;
    }

    const unitPrice = Number(tier.price ?? 0) || 0;
    if (unitPrice > 0) allFree = false;
    totalAmount += unitPrice * count;
    workItems.push({ tier, count, unitPrice });
  }

  // Payment validation for paid cart
  let paymentStatus = "not_required";
  let paymentOrderId: string | null = null;
  let paymentId: string | null = null;
  let paymentSignature: string | null = null;

  if (!allFree) {
    if (!payment?.razorpay_order_id || !payment?.razorpay_payment_id || !payment?.razorpay_signature) {
      console.error("[registerCartItems] missing payment fields — orderId:", payment?.razorpay_order_id, "paymentId:", payment?.razorpay_payment_id, "sig:", !!payment?.razorpay_signature);
      res.status(400).json({ error: "Payment details required for paid tickets" });
      return;
    }
    // Verify Razorpay signature
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET_TEST || process.env.RAZORPAY_KEY_SECRET || "";
    const expectedSig = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${payment.razorpay_order_id}|${payment.razorpay_payment_id}`)
      .digest("hex");
    console.log("[registerCartItems] sig check — orderId:", payment.razorpay_order_id, "paymentId:", payment.razorpay_payment_id, "match:", expectedSig === payment.razorpay_signature, "keySecretSet:", !!razorpaySecret);
    if (expectedSig !== payment.razorpay_signature) {
      res.status(400).json({ error: "Invalid payment signature" });
      return;
    }
    paymentStatus = "paid";
    paymentOrderId = payment.razorpay_order_id;
    paymentId = payment.razorpay_payment_id;
    paymentSignature = payment.razorpay_signature;
  }

  // Create all registrations atomically
  try {
    const createdRegistrations = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const { tier, count, unitPrice } of workItems) {
        const qrCode = `EVT-${eventId}-${crypto.randomBytes(6).toString("hex")}`;

        // Atomic capacity increment (only if tier has a cap)
        if (tier.quantity_total !== null) {
          const affected: number = await tx.$executeRaw(
            Prisma.sql`UPDATE "EventTicketTier"
                       SET "quantity_sold" = "quantity_sold" + ${count},
                           "updated_at"    = NOW()
                       WHERE "id" = ${tier.id}
                         AND "is_active" = true
                         AND "quantity_sold" + ${count} <= "quantity_total"`,
          );
          if (affected === 0) {
            throw Object.assign(new Error(`"${tier.name}" is sold out`), { http: 409, code: "TIER_FULL" });
          }
        } else {
          await tx.$executeRaw(
            Prisma.sql`UPDATE "EventTicketTier"
                       SET "quantity_sold" = "quantity_sold" + ${count}, "updated_at" = NOW()
                       WHERE "id" = ${tier.id}`,
          );
        }

        const reg = await tx.eventRegistration.create({
          data: {
            event_id: eventId,
            user_id: userId,
            ticket_tier_id: tier.id,
            ticket_count: count,
            qr_code: qrCode,
            payment_status: paymentStatus,
            payment_order_id: paymentOrderId,
            payment_id: paymentId,
            payment_signature: paymentSignature,
            amount_paid: allFree ? null : unitPrice * count,
          },
          include: { ticket_tier: true },
        });
        results.push({ ...reg, qr_code: qrCode });
      }
      return results;
    });

    res.status(201).json({ registrations: createdRegistrations });
  } catch (err: any) {
    if (err.http === 409) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[registerCartItems] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

