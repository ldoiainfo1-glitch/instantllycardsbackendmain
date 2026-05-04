import { Request, Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { paramInt } from "../utils/params";

/**
 * Multi-day agenda controller.
 *
 * Endpoints (all mounted under /api/events/:id):
 *   GET    /agenda                                — public, hydrated payload
 *   POST   /days                                  — organizer/admin
 *   PATCH  /days/:dayId
 *   DELETE /days/:dayId
 *   POST   /sessions                              — organizer/admin
 *   PATCH  /sessions/:sessionId
 *   DELETE /sessions/:sessionId
 *   POST   /sessions/reorder                      — bulk re-order within a day
 *   POST   /speakers                              — organizer/admin
 *   PATCH  /speakers/:speakerId
 *   DELETE /speakers/:speakerId
 *   POST   /sessions/:sessionId/speakers          — assign speaker
 *   DELETE /sessions/:sessionId/speakers/:speakerId
 */

// ─── Auth helpers (mirror ticketTierController) ─────────────────────────────
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
  event:
    | {
        business_promotion?: { user_id: number } | null;
        business?: { user_id: number } | null;
      }
    | null,
  req: AuthRequest,
): boolean {
  if (!event) return false;
  if (req.user?.roles?.includes("admin")) return true;
  const ownerId =
    event.business_promotion?.user_id ?? event.business?.user_id ?? null;
  return ownerId !== null && ownerId === req.user?.userId;
}

async function authorizeOrganizer(
  req: AuthRequest,
  res: Response,
  eventId: number,
): Promise<boolean> {
  const event = await loadEventForOwnerCheck(eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return false;
  }
  if (!isOwnerOrAdmin(event, req)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function parseDate(input: unknown): Date | null {
  if (input === undefined || input === null || input === "") return null;
  const d = new Date(String(input));
  return Number.isNaN(d.getTime()) ? null : d;
}

function strOrNull(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const s = String(input).trim();
  return s.length === 0 ? null : s;
}

const ALLOWED_SESSION_TYPES = new Set([
  "keynote",
  "panel",
  "workshop",
  "break",
  "networking",
  "session",
]);

const ALLOWED_SPEAKER_ROLES = new Set(["speaker", "moderator", "host"]);

// ─── GET /events/:id/agenda ─────────────────────────────────────────────────
export async function getEventAgenda(
  req: Request,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  if (!eventId) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }

  const [days, speakers] = await Promise.all([
    prisma.eventDay.findMany({
      where: { event_id: eventId },
      orderBy: { day_number: "asc" },
      include: {
        sessions: {
          orderBy: [{ start_time: "asc" }, { sort_order: "asc" }],
          include: {
            speakers: {
              include: { speaker: true },
            },
          },
        },
      },
    }),
    prisma.eventSpeaker.findMany({
      where: { event_id: eventId },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    }),
  ]);

  const shapedDays = days.map((d) => ({
    id: d.id,
    day_number: d.day_number,
    date: d.date,
    title: d.title,
    sessions: d.sessions.map((s) => ({
      id: s.id,
      day_id: s.day_id,
      title: s.title,
      description: s.description,
      start_time: s.start_time,
      end_time: s.end_time,
      session_type: s.session_type,
      location: s.location,
      sort_order: s.sort_order,
      speakers: s.speakers.map((ss) => ({
        speaker_id: ss.speaker_id,
        role: ss.role,
        name: ss.speaker.name,
        title: ss.speaker.title,
        company: ss.speaker.company,
        photo_url: ss.speaker.photo_url,
      })),
    })),
  }));

  res.json({ days: shapedDays, speakers });
}

// ─── Days ───────────────────────────────────────────────────────────────────
export async function createEventDay(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const dayNumber = Number(req.body?.day_number);
  if (!Number.isInteger(dayNumber) || dayNumber < 1) {
    res.status(400).json({ error: "day_number must be a positive integer" });
    return;
  }
  const date = parseDate(req.body?.date);
  if (!date) {
    res.status(400).json({ error: "date is required and must be ISO format" });
    return;
  }

  try {
    const day = await prisma.eventDay.create({
      data: {
        event_id: eventId,
        day_number: dayNumber,
        date,
        title: strOrNull(req.body?.title),
      },
    });
    res.status(201).json(day);
  } catch (err: any) {
    if (err?.code === "P2002") {
      res.status(409).json({ error: "Day number already exists for this event" });
      return;
    }
    console.error("[createEventDay]", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateEventDay(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const dayId = paramInt(req.params.dayId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const existing = await prisma.eventDay.findUnique({ where: { id: dayId } });
  if (!existing || existing.event_id !== eventId) {
    res.status(404).json({ error: "Day not found" });
    return;
  }

  const data: Record<string, unknown> = {};
  if (req.body?.day_number !== undefined) {
    const dn = Number(req.body.day_number);
    if (!Number.isInteger(dn) || dn < 1) {
      res.status(400).json({ error: "day_number must be a positive integer" });
      return;
    }
    data.day_number = dn;
  }
  if (req.body?.date !== undefined) {
    const d = parseDate(req.body.date);
    if (!d) {
      res.status(400).json({ error: "date must be a valid ISO date" });
      return;
    }
    data.date = d;
  }
  if (req.body?.title !== undefined) {
    data.title = strOrNull(req.body.title);
  }

  try {
    const updated = await prisma.eventDay.update({
      where: { id: dayId },
      data,
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "P2002") {
      res.status(409).json({ error: "Day number already exists for this event" });
      return;
    }
    console.error("[updateEventDay]", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteEventDay(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const dayId = paramInt(req.params.dayId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const existing = await prisma.eventDay.findUnique({ where: { id: dayId } });
  if (!existing || existing.event_id !== eventId) {
    res.status(404).json({ error: "Day not found" });
    return;
  }
  await prisma.eventDay.delete({ where: { id: dayId } });
  res.status(204).end();
}

// ─── Sessions ───────────────────────────────────────────────────────────────
function validateSessionInput(
  body: any,
  partial: boolean,
):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string } {
  const out: Record<string, unknown> = {};

  if (body?.day_id !== undefined) {
    const v = Number(body.day_id);
    if (!Number.isInteger(v) || v <= 0)
      return { ok: false, error: "day_id must be a positive integer" };
    out.day_id = v;
  } else if (!partial) {
    return { ok: false, error: "day_id is required" };
  }

  if (body?.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0)
      return { ok: false, error: "title must be a non-empty string" };
    out.title = body.title.trim();
  } else if (!partial) {
    return { ok: false, error: "title is required" };
  }

  if (body?.description !== undefined) out.description = strOrNull(body.description);

  if (body?.start_time !== undefined) {
    const d = parseDate(body.start_time);
    if (!d) return { ok: false, error: "start_time must be a valid ISO date" };
    out.start_time = d;
  } else if (!partial) {
    return { ok: false, error: "start_time is required" };
  }

  if (body?.end_time !== undefined) {
    const d = parseDate(body.end_time);
    if (!d) return { ok: false, error: "end_time must be a valid ISO date" };
    out.end_time = d;
  } else if (!partial) {
    return { ok: false, error: "end_time is required" };
  }

  if (body?.session_type !== undefined) {
    const t = String(body.session_type).toLowerCase();
    if (!ALLOWED_SESSION_TYPES.has(t))
      return {
        ok: false,
        error: `session_type must be one of: ${[...ALLOWED_SESSION_TYPES].join(", ")}`,
      };
    out.session_type = t;
  }

  if (body?.location !== undefined) out.location = strOrNull(body.location);

  if (body?.sort_order !== undefined) {
    const v = Number(body.sort_order);
    if (!Number.isInteger(v))
      return { ok: false, error: "sort_order must be an integer" };
    out.sort_order = v;
  }

  if (
    out.start_time instanceof Date &&
    out.end_time instanceof Date &&
    out.start_time > out.end_time
  ) {
    return { ok: false, error: "start_time must be before end_time" };
  }

  return { ok: true, data: out };
}

export async function createEventSession(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const v = validateSessionInput(req.body ?? {}, false);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }

  // Verify day belongs to this event
  const day = await prisma.eventDay.findUnique({
    where: { id: v.data.day_id as number },
  });
  if (!day || day.event_id !== eventId) {
    res.status(400).json({ error: "day_id does not belong to this event" });
    return;
  }

  try {
    const session = await prisma.eventSession.create({
      data: {
        event_id: eventId,
        day_id: v.data.day_id as number,
        title: v.data.title as string,
        description: (v.data.description as string | null) ?? null,
        start_time: v.data.start_time as Date,
        end_time: v.data.end_time as Date,
        session_type: (v.data.session_type as string) ?? "session",
        location: (v.data.location as string | null) ?? null,
        sort_order: (v.data.sort_order as number) ?? 0,
      },
    });
    res.status(201).json(session);
  } catch (err) {
    console.error("[createEventSession]", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateEventSession(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const sessionId = paramInt(req.params.sessionId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const existing = await prisma.eventSession.findUnique({
    where: { id: sessionId },
  });
  if (!existing || existing.event_id !== eventId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const v = validateSessionInput(req.body ?? {}, true);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }

  if (v.data.day_id !== undefined) {
    const day = await prisma.eventDay.findUnique({
      where: { id: v.data.day_id as number },
    });
    if (!day || day.event_id !== eventId) {
      res.status(400).json({ error: "day_id does not belong to this event" });
      return;
    }
  }

  // Cross-field invariant when only one of start/end provided
  const finalStart = (v.data.start_time as Date | undefined) ?? existing.start_time;
  const finalEnd = (v.data.end_time as Date | undefined) ?? existing.end_time;
  if (finalStart > finalEnd) {
    res.status(400).json({ error: "start_time must be before end_time" });
    return;
  }

  try {
    const updated = await prisma.eventSession.update({
      where: { id: sessionId },
      data: v.data,
    });
    res.json(updated);
  } catch (err) {
    console.error("[updateEventSession]", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteEventSession(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const sessionId = paramInt(req.params.sessionId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const existing = await prisma.eventSession.findUnique({
    where: { id: sessionId },
  });
  if (!existing || existing.event_id !== eventId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await prisma.eventSession.delete({ where: { id: sessionId } });
  res.status(204).end();
}

export async function reorderEventSessions(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const orders = req.body?.orders;
  if (!Array.isArray(orders) || orders.length === 0) {
    res
      .status(400)
      .json({ error: "orders[] required, each { session_id, sort_order }" });
    return;
  }

  const updates: { id: number; sort_order: number }[] = [];
  for (const o of orders) {
    const id = Number(o?.session_id);
    const so = Number(o?.sort_order);
    if (!Number.isInteger(id) || !Number.isInteger(so)) {
      res
        .status(400)
        .json({ error: "each entry must have integer session_id and sort_order" });
      return;
    }
    updates.push({ id, sort_order: so });
  }

  // Ensure all belong to this event
  const sessions = await prisma.eventSession.findMany({
    where: { id: { in: updates.map((u) => u.id) } },
    select: { id: true, event_id: true },
  });
  const allValid = sessions.every((s) => s.event_id === eventId);
  if (!allValid || sessions.length !== updates.length) {
    res.status(400).json({ error: "One or more sessions do not belong to this event" });
    return;
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.eventSession.update({
        where: { id: u.id },
        data: { sort_order: u.sort_order },
      }),
    ),
  );
  res.status(204).end();
}

// ─── Speakers ───────────────────────────────────────────────────────────────
function validateSpeakerInput(
  body: any,
  partial: boolean,
):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string } {
  const out: Record<string, unknown> = {};

  if (body?.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0)
      return { ok: false, error: "name must be a non-empty string" };
    out.name = body.name.trim();
  } else if (!partial) {
    return { ok: false, error: "name is required" };
  }

  for (const key of [
    "title",
    "company",
    "bio",
    "photo_url",
    "linkedin_url",
    "twitter_url",
    "website_url",
  ]) {
    if (body?.[key] !== undefined) out[key] = strOrNull(body[key]);
  }

  if (body?.sort_order !== undefined) {
    const v = Number(body.sort_order);
    if (!Number.isInteger(v))
      return { ok: false, error: "sort_order must be an integer" };
    out.sort_order = v;
  }

  return { ok: true, data: out };
}

export async function createEventSpeaker(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const v = validateSpeakerInput(req.body ?? {}, false);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }

  try {
    const speaker = await prisma.eventSpeaker.create({
      data: {
        event_id: eventId,
        name: v.data.name as string,
        title: (v.data.title as string | null) ?? null,
        company: (v.data.company as string | null) ?? null,
        bio: (v.data.bio as string | null) ?? null,
        photo_url: (v.data.photo_url as string | null) ?? null,
        linkedin_url: (v.data.linkedin_url as string | null) ?? null,
        twitter_url: (v.data.twitter_url as string | null) ?? null,
        website_url: (v.data.website_url as string | null) ?? null,
        sort_order: (v.data.sort_order as number) ?? 0,
      },
    });
    res.status(201).json(speaker);
  } catch (err) {
    console.error("[createEventSpeaker]", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateEventSpeaker(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const speakerId = paramInt(req.params.speakerId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const existing = await prisma.eventSpeaker.findUnique({
    where: { id: speakerId },
  });
  if (!existing || existing.event_id !== eventId) {
    res.status(404).json({ error: "Speaker not found" });
    return;
  }

  const v = validateSpeakerInput(req.body ?? {}, true);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }

  try {
    const updated = await prisma.eventSpeaker.update({
      where: { id: speakerId },
      data: v.data,
    });
    res.json(updated);
  } catch (err) {
    console.error("[updateEventSpeaker]", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteEventSpeaker(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const speakerId = paramInt(req.params.speakerId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const existing = await prisma.eventSpeaker.findUnique({
    where: { id: speakerId },
  });
  if (!existing || existing.event_id !== eventId) {
    res.status(404).json({ error: "Speaker not found" });
    return;
  }
  await prisma.eventSpeaker.delete({ where: { id: speakerId } });
  res.status(204).end();
}

// ─── Session ↔ Speaker assignments ──────────────────────────────────────────
export async function assignSessionSpeaker(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const sessionId = paramInt(req.params.sessionId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const speakerId = Number(req.body?.speaker_id);
  if (!Number.isInteger(speakerId) || speakerId <= 0) {
    res.status(400).json({ error: "speaker_id is required" });
    return;
  }
  const role = strOrNull(req.body?.role) ?? "speaker";
  if (!ALLOWED_SPEAKER_ROLES.has(role)) {
    res.status(400).json({
      error: `role must be one of: ${[...ALLOWED_SPEAKER_ROLES].join(", ")}`,
    });
    return;
  }

  const [session, speaker] = await Promise.all([
    prisma.eventSession.findUnique({ where: { id: sessionId } }),
    prisma.eventSpeaker.findUnique({ where: { id: speakerId } }),
  ]);
  if (!session || session.event_id !== eventId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (!speaker || speaker.event_id !== eventId) {
    res.status(404).json({ error: "Speaker not found" });
    return;
  }

  try {
    const link = await prisma.eventSessionSpeaker.upsert({
      where: {
        session_id_speaker_id: { session_id: sessionId, speaker_id: speakerId },
      },
      update: { role },
      create: { session_id: sessionId, speaker_id: speakerId, role },
    });
    res.status(201).json(link);
  } catch (err) {
    console.error("[assignSessionSpeaker]", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function unassignSessionSpeaker(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const sessionId = paramInt(req.params.sessionId);
  const speakerId = paramInt(req.params.speakerId);
  if (!(await authorizeOrganizer(req, res, eventId))) return;

  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || session.event_id !== eventId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await prisma.eventSessionSpeaker
    .delete({
      where: {
        session_id_speaker_id: { session_id: sessionId, speaker_id: speakerId },
      },
    })
    .catch(() => undefined);
  res.status(204).end();
}
