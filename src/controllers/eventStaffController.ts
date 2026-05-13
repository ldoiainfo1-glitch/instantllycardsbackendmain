import { Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { paramInt } from "../utils/params";
import { notify } from "../utils/notify";
import { phoneVariants } from "../utils/phone";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the owning userId of an event (via business_promotion or business).
 * Returns null if event not found.
 */
async function getEventOwnerId(eventId: number): Promise<number | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      business_promotion: { select: { user_id: true } },
      business: { select: { user_id: true } },
    },
  });
  if (!event) return null;
  return event.business_promotion?.user_id ?? event.business?.user_id ?? null;
}

/**
 * Returns the staff role of a user for a given event, or null if not staff.
 */
export async function getStaffRole(
  eventId: number,
  userId: number,
): Promise<string | null> {
  const row = await prisma.eventStaff.findUnique({
    where: { event_id_user_id: { event_id: eventId, user_id: userId } },
    select: { role: true },
  });
  return row?.role ?? null;
}

/**
 * Returns true if the userId is the owner OR an allowed staff role for eventId.
 */
export async function canAccessEvent(
  eventId: number,
  userId: number,
  allowedRoles: string[],
): Promise<boolean> {
  const ownerId = await getEventOwnerId(eventId);
  if (ownerId === userId) return true;
  const role = await getStaffRole(eventId, userId);
  return role !== null && allowedRoles.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id/staff
// ─────────────────────────────────────────────────────────────────────────────
export async function listEventStaff(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const userId = req.user!.userId;

  const ownerId = await getEventOwnerId(eventId);
  if (ownerId === null) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  // Only owner or co_organizer can list staff
  if (ownerId !== userId) {
    const role = await getStaffRole(eventId, userId);
    if (role !== "co_organizer") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  const staff = await prisma.eventStaff.findMany({
    where: { event_id: eventId },
    include: {
      user: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { created_at: "asc" },
  });

  res.json({
    data: staff.map((s) => ({
      id: s.id,
      user_id: s.user_id,
      name: s.user.name,
      phone: s.user.phone,
      role: s.role,
      invited_by: s.invited_by,
      created_at: s.created_at,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /events/:id/staff
// Body: { phone: string, role: "co_organizer" | "scanner" }
// Only the event owner can invite staff.
// ─────────────────────────────────────────────────────────────────────────────
export async function addEventStaff(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const inviterId = req.user!.userId;
  const { phone, role } = req.body as { phone?: string; role?: string };

  if (!phone || !["co_organizer", "scanner"].includes(role ?? "")) {
    res.status(400).json({ error: "phone and role (co_organizer|scanner) required" });
    return;
  }

  const ownerId = await getEventOwnerId(eventId);
  if (ownerId === null) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (ownerId !== inviterId && !req.user!.roles.includes("admin")) {
    res.status(403).json({ error: "Only the event owner can add staff" });
    return;
  }

  // Find user by phone — try all common variants (+91XXXXXXXXXX, 0XXXXXXXXXX, 10-digit)
  const variants = phoneVariants(phone.trim());
  const targetUser = await prisma.user.findFirst({
    where: { OR: variants.map((p) => ({ phone: p })) },
    select: { id: true, name: true, phone: true },
  });
  if (!targetUser) {
    res.status(404).json({ error: "No user found with that phone number" });
    return;
  }
  if (targetUser.id === inviterId) {
    res.status(400).json({ error: "You cannot add yourself as staff" });
    return;
  }

  // Fetch event title for notification message
  const eventRecord = await prisma.event.findUnique({
    where: { id: eventId },
    select: { title: true },
  });
  const eventTitle = eventRecord?.title ?? "an event";

  // Upsert — if already a member, update role
  const staff = await prisma.eventStaff.upsert({
    where: { event_id_user_id: { event_id: eventId, user_id: targetUser.id } },
    create: {
      event_id: eventId,
      user_id: targetUser.id,
      role: role!,
      invited_by: inviterId,
    },
    update: { role: role! },
    include: { user: { select: { id: true, name: true, phone: true, push_token: true } } },
  });

  // Send notification to the newly assigned staff member
  try {
    const isCoOrganizer = role === "co_organizer";
    await notify({
      userId: targetUser.id,
      pushToken: (staff.user as any).push_token ?? undefined,
      title: isCoOrganizer ? "🎉 You're a Co-organizer!" : "🎟️ You're a Check-in Volunteer!",
      body: isCoOrganizer
        ? `You have been appointed as a co-organizer for "${eventTitle}". You can now manage the event.`
        : `You have been appointed as a check-in volunteer for "${eventTitle}". Use the Scan Check-in button to let attendees in.`,
      type: isCoOrganizer ? "EVENT_STAFF_CO_ORGANIZER" : "EVENT_STAFF_SCANNER",
      data: { event_id: eventId },
    });
  } catch (notifyErr) {
    console.error("[addEventStaff] notify failed:", notifyErr);
  }

  res.status(201).json({
    data: {
      id: staff.id,
      user_id: staff.user_id,
      name: staff.user.name,
      phone: staff.user.phone,
      role: staff.role,
      invited_by: staff.invited_by,
      created_at: staff.created_at,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /events/:id/staff/:staffId
// Only the event owner can remove staff.
// ─────────────────────────────────────────────────────────────────────────────
export async function removeEventStaff(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const eventId = paramInt(req.params.id);
  const staffId = paramInt(req.params.staffId);
  const userId = req.user!.userId;

  const ownerId = await getEventOwnerId(eventId);
  if (ownerId === null) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (ownerId !== userId && !req.user!.roles.includes("admin")) {
    res.status(403).json({ error: "Only the event owner can remove staff" });
    return;
  }

  const row = await prisma.eventStaff.findFirst({
    where: { id: staffId, event_id: eventId },
  });
  if (!row) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  await prisma.eventStaff.delete({ where: { id: staffId } });
  res.json({ success: true });
}
