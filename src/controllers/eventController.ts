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

function parseTicketCount(input: unknown): number {
  const count =
    input === undefined || input === null ? 1 : parseInt(String(input), 10);
  if (!Number.isFinite(count) || count <= 0) return 1;
  return count;
}

function calculateTicketAmountPaise(
  ticketPrice: number,
  ticketCount: number,
): number {
  return Math.round(ticketPrice * 100) * ticketCount;
}

export async function listEvents(req: Request, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;
  console.log(
    "[listEvents] page:",
    page,
    "limit:",
    limit,
    "search:",
    search,
    "category:",
    category,
  );

  const where: any = { status: "active" };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
      { venue: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
      { state: { contains: search, mode: "insensitive" } },
      { event_type: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ];
  }
  if (category) {
    where.category = { contains: category, mode: "insensitive" };
  }

  try {
    const events = await prisma.event.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: "asc" },
      include: {
        business: {
          select: {
            id: true,
            company_name: true,
            logo_url: true,
            full_name: true,
          },
        },
        _count: { select: { registrations: true } },
      },
    });
    console.log("[listEvents] returned", events.length, "events");
    res.json({ data: events, page, limit });
  } catch (err) {
    console.error("[listEvents] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getEvent(req: Request, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  console.log("[getEvent] id:", id);
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
        _count: { select: { registrations: true } },
      },
    });
    if (!event) {
      console.log("[getEvent] not found for id:", id);
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.log(
      "[getEvent] found:",
      event.id,
      event.title,
      "status:",
      event.status,
      "price:",
      event.ticket_price,
    );
    res.json(event);
  } catch (err) {
    console.error("[getEvent] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function listMyEvents(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  console.log("[listMyEvents] userId:", req.user!.userId);
  try {
    const promotions = await prisma.businessPromotion.findMany({
      where: { user_id: req.user!.userId },
      select: { id: true },
    });
    const promotionIds = promotions.map((p) => p.id);
    console.log("[listMyEvents] businessPromotionIds:", promotionIds);

    if (promotionIds.length === 0) {
      res.json([]);
      return;
    }

    const events = await prisma.event.findMany({
      where: { business_promotion_id: { in: promotionIds } },
      orderBy: { date: "desc" },
      include: {
        _count: { select: { registrations: true } },
        business_promotion: {
          select: { id: true, business_name: true, business_card_id: true },
        },
      },
    });
    console.log("[listMyEvents] returned", events.length, "events");
    res.json(events);
  } catch (err) {
    console.error("[listMyEvents] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
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
    time,
    location,
    image_url,
    ticket_price,
    max_attendees,
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
    const event = await prisma.event.create({
      data: {
        business_promotion_id: promotion.id,
        business_id: promotion.business_card_id ?? null,
        title,
        description: description || null,
        date: new Date(date),
        time,
        location: location || null,
        image_url: image_url || null,
        ticket_price: ticket_price ? parseFloat(ticket_price) : null,
        max_attendees: max_attendees ? parseInt(max_attendees, 10) : null,
        status: "active",
      },
      include: {
        business_promotion: {
          select: { id: true, business_name: true, business_card_id: true },
        },
        business: { select: { id: true, company_name: true } },
      },
    });
    console.log("[createEvent] success — event.id:", event.id);
    res.status(201).json(event);
  } catch (err) {
    console.error("[createEvent] prisma error:", err);
    res.status(500).json({ error: "Internal server error" });
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
    if (
      ownerUserId !== req.user!.userId &&
      !req.user!.roles.includes("admin")
    ) {
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
      "time",
      "location",
      "image_url",
      "ticket_price",
      "max_attendees",
      "status",
    ];
    const data: any = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        if (key === "date") data[key] = new Date(req.body[key]);
        else if (key === "ticket_price") data[key] = parseFloat(req.body[key]);
        else if (key === "max_attendees")
          data[key] = parseInt(req.body[key], 10);
        else data[key] = req.body[key];
      }
    }
    console.log("[updateEvent] applying data:", JSON.stringify(data));

    const updated = await prisma.event.update({ where: { id }, data });
    console.log("[updateEvent] success — event:", updated.id, updated.title);
    res.json(updated);
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
  const { ticket_count, payment } = req.body;
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
        if (organizer.push_token) {
          sendExpoPushNotification(
            organizer.push_token,
            "New Event Registration",
            `${attendee?.name ?? "Someone"} registered for "${event.title}"`,
            { screen: "Events" },
          );
        }
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
      include: { event: true },
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
    });

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

    // Only allow event owner or admin to verify
    const event = await prisma.event.findUnique({
      where: { id: registration.event_id },
      include: {
        business_promotion: { select: { user_id: true } },
        business: { select: { user_id: true } },
      },
    });
    const ownerUserId =
      event?.business_promotion?.user_id ?? event?.business?.user_id ?? null;
    if (
      event &&
      ownerUserId !== req.user!.userId &&
      !req.user!.roles.includes("admin")
    ) {
      console.log(
        "[verifyRegistration] forbidden — owner:",
        ownerUserId,
        "requester:",
        req.user!.userId,
      );
      res
        .status(403)
        .json({
          error: "Only the event organizer or admin can verify registrations",
        });
      return;
    }

    console.log(
      "[verifyRegistration] SUCCESS — regId:",
      registration.id,
      "paymentStatus:",
      registration.payment_status,
    );
    res.json({
      registration_id: registration.id,
      qr_code: registration.qr_code,
      ticket_count: registration.ticket_count,
      payment_status: registration.payment_status,
      amount_paid: registration.amount_paid,
      registered_at: registration.registered_at,
      user: registration.user,
      event: registration.event,
    });
  } catch (err) {
    console.error("[verifyRegistration] ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
