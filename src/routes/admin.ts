import { Router, Request, Response, RequestHandler } from "express";
import { requireAdminKey, AuthRequest } from "../middleware/auth";
import prisma from "../utils/prisma";
import { getIo } from "../utils/socket";
import {
  getDashboardCounts,
  getPendingPromotions,
  approvePromotion,
  rejectPromotion,
  listUsers,
  listAdCampaigns,
  approveAdCampaign,
  rejectAdCampaign,
  listBusinesses,
  approveBusinessCard,
  rejectBusinessCard,
  listEvents,
  listVouchers,
  listReviews,
} from "../controllers/adminController";

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.use(requireAdminKey);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/dashboard", h(getDashboardCounts));
router.get("/stats", h(getDashboardCounts));

// ── Users ─────────────────────────────────────────────────────────────────────
router.get("/users", h(listUsers));

router.get(
  "/users/export",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          created_at: true,
          credits: true,
        },
      });
      const header = "id,name,phone,email,credits,created_at\n";
      const rows = users
        .map(
          (u) =>
            `${u.id},"${u.name ?? ""}","${u.phone ?? ""}","${u.email ?? ""}",${Number(u.credits)},${u.created_at?.toISOString() ?? ""}`,
        )
        .join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="users.csv"');
      res.send(header + rows);
    } catch (err) {
      console.error("[admin/users/export]", err);
      res.status(500).json({ error: "Failed to export users" });
    }
  },
);

router.get(
  "/users/export-phones",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        select: { id: true, name: true, phone: true },
      });
      const header = "id,name,phone\n";
      const rows = users
        .map((u) => `${u.id},"${u.name ?? ""}","${u.phone ?? ""}"`)
        .join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="phones.csv"');
      res.send(header + rows);
    } catch (err) {
      console.error("[admin/users/export-phones]", err);
      res.status(500).json({ error: "Failed to export phones" });
    }
  },
);

router.get(
  "/users/by-phone/:phone",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const phone = decodeURIComponent(req.params["phone"] as string);
      const user = await prisma.user.findFirst({
        where: { phone },
        include: { profile: true },
      });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({
        success: true,
        user: { ...user, credits: Number(user.credits) },
      });
    } catch (err) {
      console.error("[admin/users/by-phone]", err);
      res.status(500).json({ error: "Failed to find user" });
    }
  },
);

router.get(
  "/users/:id/contacts/export",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Number(req.params.id);
      const contacts = await prisma.contact.findMany({
        where: { user_id: userId },
        select: { id: true, name: true, phone_number: true, created_at: true },
      });
      const header = "id,name,phone,created_at\n";
      const rows = contacts
        .map(
          (c) =>
            `${c.id},"${c.name ?? ""}","${c.phone_number ?? ""}",${c.created_at?.toISOString() ?? ""}`,
        )
        .join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="contacts_${userId}.csv"`,
      );
      res.send(header + rows);
    } catch (err) {
      console.error("[admin/contacts/export]", err);
      res.status(500).json({ error: "Failed to export contacts" });
    }
  },
);

router.get(
  "/users/:id/voucher-stats",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Number(req.params.id);
      const where: any = { user_id: userId };
      if (req.query.voucherId) where.voucher_id = Number(req.query.voucherId);
      const claims = await prisma.voucherClaim.findMany({
        where,
        include: { voucher: true },
      });
      res.json({ success: true, claims, total: claims.length });
    } catch (err) {
      console.error("[admin/voucher-stats]", err);
      res.status(500).json({ error: "Failed to fetch voucher stats" });
    }
  },
);

router.put(
  "/users/:id/update-credits",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { credits } = req.body;
      const userId = Number(req.params.id);
      const newCredits = Number(credits);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const diff = newCredits - Number(user.credits ?? 0);
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { credits: BigInt(newCredits) },
      });
      if (diff !== 0) {
        await prisma.transaction.create({
          data: {
            type: "admin_adjustment",
            transaction_id:
              "TXN" + Math.random().toString(36).slice(2).toUpperCase(),
            ...(diff > 0 ? { to_user_id: userId } : { from_user_id: userId }),
            amount: Math.abs(diff),
            description: "Admin credit update",
            status: "completed",
          },
        });
      }
      res.json({
        success: true,
        user: { ...updatedUser, credits: Number(updatedUser.credits) },
      });
    } catch (err) {
      console.error("[admin/update-credits]", err);
      res.status(500).json({ error: "Failed to update credits" });
    }
  },
);

router.put(
  "/users/:id/update-vouchers",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Number(req.params.id);
      const { voucherId, action } = req.body;
      if (!voucherId) {
        res.status(400).json({ error: "voucherId required" });
        return;
      }
      if (action === "remove") {
        await prisma.voucherClaim.deleteMany({
          where: { user_id: userId, voucher_id: Number(voucherId) },
        });
      } else {
        await prisma.voucherClaim.create({
          data: { user_id: userId, voucher_id: Number(voucherId) },
        });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[admin/update-vouchers]", err);
      res.status(500).json({ error: "Failed to update vouchers" });
    }
  },
);

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get(
  "/analytics/user-growth",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const days = Number(req.query.days || 30);
      const since = new Date(Date.now() - days * 86400000);
      const users = await prisma.user.findMany({
        where: { created_at: { gte: since } },
        select: { created_at: true },
        orderBy: { created_at: "asc" },
      });
      const byDate: Record<string, number> = {};
      users.forEach((u) => {
        const d = u.created_at?.toISOString().slice(0, 10) ?? "";
        byDate[d] = (byDate[d] ?? 0) + 1;
      });
      res.json({
        success: true,
        data: Object.entries(byDate).map(([date, count]) => ({ date, count })),
        total: users.length,
      });
    } catch (err) {
      console.error("[admin/analytics/user-growth]", err);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  },
);

// ── Promotions ────────────────────────────────────────────────────────────────
router.get("/promotions/pending", h(getPendingPromotions));
router.post("/promotions/:id/approve", h(approvePromotion));
router.post("/promotions/:id/reject", h(rejectPromotion));

// ── Listings ──────────────────────────────────────────────────────────────────
router.get("/businesses", h(listBusinesses));
router.post("/businesses/:id/approve", h(approveBusinessCard));
router.post("/businesses/:id/reject", h(rejectBusinessCard));
router.get("/events", h(listEvents));
router.get("/reviews", h(listReviews));

// ── Vouchers ──────────────────────────────────────────────────────────────────
router.get("/vouchers", h(listVouchers));

router.put(
  "/vouchers/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        title,
        description,
        discount_type,
        discount_value,
        max_claims,
        expires_at,
      } = req.body;
      const voucher = await prisma.voucher.update({
        where: { id: Number(req.params.id) },
        data: {
          title,
          description,
          discount_type,
          discount_value:
            discount_value != null ? Number(discount_value) : undefined,
          max_claims: max_claims != null ? Number(max_claims) : undefined,
          expires_at: expires_at ? new Date(expires_at) : undefined,
        },
      });
      res.json({ success: true, voucher });
    } catch (err) {
      console.error("[admin/vouchers/update]", err);
      res.status(500).json({ error: "Failed to update voucher" });
    }
  },
);

router.delete(
  "/vouchers/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      await prisma.voucher.delete({ where: { id: Number(req.params.id) } });
      res.json({ success: true });
    } catch (err) {
      console.error("[admin/vouchers/delete]", err);
      res.status(500).json({ error: "Failed to delete voucher" });
    }
  },
);

router.post(
  "/vouchers/:id/publish",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const voucher = await prisma.voucher.update({
        where: { id: Number(req.params.id) },
        data: { status: "active" },
      });
      res.json({ success: true, voucher });
    } catch (err) {
      console.error("[admin/vouchers/publish]", err);
      res.status(500).json({ error: "Failed to publish voucher" });
    }
  },
);

router.post(
  "/vouchers/:id/unpublish",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const voucher = await prisma.voucher.update({
        where: { id: Number(req.params.id) },
        data: { status: "inactive" },
      });
      res.json({ success: true, voucher });
    } catch (err) {
      console.error("[admin/vouchers/unpublish]", err);
      res.status(500).json({ error: "Failed to unpublish voucher" });
    }
  },
);

// ── Ad campaigns ──────────────────────────────────────────────────────────────
router.get("/ads", h(listAdCampaigns));
router.get("/ads/:id", async (req, res) => {
  const { getAdCampaignDetails } =
    await import("../controllers/adminController");
  return getAdCampaignDetails(req as unknown as AuthRequest, res);
});
router.post("/ads/:id/approve", h(approveAdCampaign));
router.post("/ads/:id/reject", h(rejectAdCampaign));
router.post("/ads/:id/pause", async (req, res) => {
  const { pauseAdCampaign } = await import("../controllers/adminController");
  return pauseAdCampaign(req as unknown as AuthRequest, res);
});
router.post("/ads/:id/resume", async (req, res) => {
  const { resumeAdCampaign } = await import("../controllers/adminController");
  return resumeAdCampaign(req as unknown as AuthRequest, res);
});
router.post("/ads/:id/delete", async (req, res) => {
  const { deleteAdCampaign } = await import("../controllers/adminController");
  return deleteAdCampaign(req as unknown as AuthRequest, res);
});

// ── Credit transfer ───────────────────────────────────────────────────────────
router.post(
  "/transfer-credits",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId, amount, note } = req.body;
      const creditAmount = Number(amount);
      if (!userId || !creditAmount) {
        res.status(400).json({ error: "userId and amount are required" });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: Number(userId) },
      });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const newBalance = Number(user.credits ?? 0) + creditAmount;
      await prisma.user.update({
        where: { id: Number(userId) },
        data: { credits: BigInt(newBalance) },
      });
      await prisma.transaction.create({
        data: {
          type: "admin_adjustment",
          transaction_id:
            "TXN" + Math.random().toString(36).slice(2).toUpperCase(),
          to_user_id: Number(userId),
          amount: creditAmount,
          description: note || "Admin credit adjustment",
          status: "completed",
        },
      });
      const io = getIo();
      io?.emit(`credits_updated_${userId}`, { credits: newBalance });
      res.json({ success: true, newBalance });
    } catch (err) {
      console.error("[admin/transfer-credits]", err);
      res.status(500).json({ error: "Failed to transfer credits" });
    }
  },
);

// POST /api/admin/credits/transfer  (alias)
router.post(
  "/credits/transfer",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId, amount, note } = req.body;
      const creditAmount = Number(amount);
      if (!userId || !creditAmount) {
        res.status(400).json({ error: "userId and amount are required" });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: Number(userId) },
      });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const newBalance = Number(user.credits ?? 0) + creditAmount;
      await prisma.user.update({
        where: { id: Number(userId) },
        data: { credits: BigInt(newBalance) },
      });
      await prisma.transaction.create({
        data: {
          type: "admin_adjustment",
          transaction_id:
            "TXN" + Math.random().toString(36).slice(2).toUpperCase(),
          to_user_id: Number(userId),
          amount: creditAmount,
          description: note || "Admin credit transfer",
          status: "completed",
        },
      });
      res.json({ success: true, newBalance });
    } catch (err) {
      console.error("[admin/credits/transfer]", err);
      res.status(500).json({ error: "Failed to transfer credits" });
    }
  },
);

router.get(
  "/all-transactions",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit || "20"), 10)),
      );
      const where: any = {};
      if (req.query.type) where.type = req.query.type;
      if (req.query.userId)
        where.OR = [
          { from_user_id: Number(req.query.userId) },
          { to_user_id: Number(req.query.userId) },
        ];
      const [rows, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: { created_at: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            from_user: { select: { id: true, name: true, phone: true } },
            to_user: { select: { id: true, name: true, phone: true } },
          },
        }),
        prisma.transaction.count({ where }),
      ]);
      res.json({
        transactions: rows,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total,
      });
    } catch (err) {
      console.error("[admin/all-transactions]", err);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  },
);

// ── Referral tracking ─────────────────────────────────────────────────────────
router.get(
  "/referral-tracking",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Number(req.query.limit || 20));
      const search = req.query.search as string | undefined;
      const where: any = {};
      if (search)
        where.OR = [
          { referrer: { name: { contains: search, mode: "insensitive" } } },
          { referred: { name: { contains: search, mode: "insensitive" } } },
        ];
      const [referrals, total] = await Promise.all([
        prisma.referral.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { created_at: "desc" },
          include: {
            referrer: { select: { id: true, name: true, phone: true } },
            referred: { select: { id: true, name: true, phone: true } },
          },
        }),
        prisma.referral.count({ where }),
      ]);
      res.json({
        success: true,
        referrals,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error("[admin/referral-tracking]", err);
      res.status(500).json({ error: "Failed to fetch referrals" });
    }
  },
);

router.get(
  "/referral-chain/:userId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Number(req.params.userId);
      const referrals = await prisma.referral.findMany({
        where: { OR: [{ referrer_id: userId }, { referred_id: userId }] },
        include: {
          referrer: { select: { id: true, name: true, phone: true } },
          referred: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { created_at: "desc" },
      });
      res.json({ success: true, chain: referrals });
    } catch (err) {
      console.error("[admin/referral-chain]", err);
      res.status(500).json({ error: "Failed to fetch referral chain" });
    }
  },
);

// ── MLM slots ─────────────────────────────────────────────────────────────────
router.get("/mlm/slots", async (req: Request, res: Response): Promise<void> => {
  try {
    const where: any = {};
    if (req.query.voucherId) where.voucher_id = Number(req.query.voucherId);
    const slots = await prisma.slotEvent.findMany({
      where,
      orderBy: { created_at: "desc" },
    });
    res.json({ success: true, slots });
  } catch (err) {
    console.error("[admin/mlm/slots]", err);
    res.status(500).json({ error: "Failed to fetch slots" });
  }
});

router.post(
  "/mlm/slots/initialize",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { voucherId, userId, eventType } = req.body;
      if (!voucherId) {
        res.status(400).json({ error: "voucherId required" });
        return;
      }
      const slot = await prisma.slotEvent.create({
        data: {
          voucher_id: Number(voucherId),
          user_id: userId ? Number(userId) : undefined,
          event_type: eventType || "initialize",
        },
      });
      res.json({ success: true, slot });
    } catch (err) {
      console.error("[admin/mlm/slots/initialize]", err);
      res.status(500).json({ error: "Failed to initialize slot" });
    }
  },
);

router.post(
  "/mlm/slots/increase",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { voucherId, userId } = req.body;
      if (!voucherId) {
        res.status(400).json({ error: "voucherId required" });
        return;
      }
      const slot = await prisma.slotEvent.create({
        data: {
          voucher_id: Number(voucherId),
          user_id: userId ? Number(userId) : undefined,
          event_type: "increase",
        },
      });
      res.json({ success: true, slot });
    } catch (err) {
      console.error("[admin/mlm/slots/increase]", err);
      res.status(500).json({ error: "Failed to increase slot" });
    }
  },
);

router.delete(
  "/mlm/slots",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { slotId } = req.body;
      if (!slotId) {
        res.status(400).json({ error: "slotId required" });
        return;
      }
      await prisma.slotEvent.delete({ where: { id: Number(slotId) } });
      res.json({ success: true });
    } catch (err) {
      console.error("[admin/mlm/slots/delete]", err);
      res.status(500).json({ error: "Failed to delete slot" });
    }
  },
);

// ── Admin Events (Prisma public."Event" — backend DB) ────────────────────────

// List all events
router.get(
  "/admin-events",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Number(req.query.limit || 50));
      const skip = (page - 1) * limit;

      const [events, total] = await Promise.all([
        prisma.event.findMany({
          orderBy: { created_at: "desc" },
          skip,
          take: limit,
        }),
        prisma.event.count(),
      ]);

      res.json({
        success: true,
        events,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error("[admin/admin-events]", err);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  },
);

// Bulk upload events parsed from Excel
router.post(
  "/admin-events/bulk-upload",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { events } = req.body as { events: any[] };
      if (!Array.isArray(events) || events.length === 0) {
        res
          .status(400)
          .json({ error: "events array is required and must not be empty" });
        return;
      }

      let insertedCount = 0;
      const errors: string[] = [];

      for (const ev of events) {
        const title = String(ev.eventName || "").trim();
        const venue = String(ev.venue || "").trim();

        if (!title) {
          errors.push(`Sr No ${ev.srNo ?? "?"}: Event Name is required`);
          continue;
        }

        try {
          const startDate = ev.startDate ? new Date(ev.startDate) : new Date();
          const endDate = ev.endDate ? new Date(ev.endDate) : null;
          const price = ev.price != null ? Number(ev.price) : 0;
          const isFree = price === 0;

          await prisma.event.create({
            data: {
              title,
              date: startDate,
              time: "TBD",
              location: venue || null,
              description: null,
              status: "active",
              uploaded_by_admin: true,
              sr_no: ev.srNo != null ? Number(ev.srNo) : null,
              start_date: startDate,
              end_date: endDate,
              days: ev.days != null ? Number(ev.days) : null,
              city: ev.city || null,
              state: ev.state || null,
              event_type: ev.eventType || null,
              source_website: ev.sourceWebsite || null,
              venue: venue || null,
              category: ev.category || null,
              is_free: isFree,
              price,
              is_featured: false,
            },
          });

          insertedCount++;
        } catch (rowErr) {
          console.error(`[bulk-upload] Row error Sr No ${ev.srNo}:`, rowErr);
          errors.push(`Sr No ${ev.srNo ?? "?"}: ${(rowErr as Error).message}`);
        }
      }

      res.json({ success: true, inserted: insertedCount, errors });
    } catch (err) {
      console.error("[admin/admin-events/bulk-upload]", err);
      res.status(500).json({ error: "Failed to upload events" });
    }
  },
);

// Delete an event
router.delete(
  "/admin-events/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid event id" });
        return;
      }
      await prisma.event.delete({ where: { id } });
      res.json({ success: true });
    } catch (err) {
      console.error("[admin/admin-events/delete]", err);
      res.status(500).json({ error: "Failed to delete event" });
    }
  },
);

// Toggle featured / update event
router.patch(
  "/admin-events/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid event id" });
        return;
      }
      const { is_featured } = req.body as { is_featured?: boolean };
      if (is_featured !== undefined) {
        await prisma.event.update({ where: { id }, data: { is_featured } });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[admin/admin-events/patch]", err);
      res.status(500).json({ error: "Failed to update event" });
    }
  },
);

// Get registrations for an event
router.get(
  "/admin-events/:id/registrations",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid event id" });
        return;
      }
      const registrations = await prisma.eventRegistration.findMany({
        where: { event_id: id },
        include: { user: { select: { name: true, email: true, phone: true } } },
        orderBy: { registered_at: "desc" },
      });
      res.json({ success: true, registrations });
    } catch (err) {
      console.error("[admin/admin-events/registrations]", err);
      res.status(500).json({ error: "Failed to fetch registrations" });
    }
  },
);

export default router;
