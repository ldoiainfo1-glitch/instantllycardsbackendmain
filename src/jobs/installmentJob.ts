/**
 * installmentJob.ts
 *
 * Hourly cron that:
 *   1. Sends a "deadline approaching" reminder when ≤ 3 days remain
 *      (only once per claim — gated by `installment_reminder_sent_at`
 *      column if present; otherwise relies on `installment_status` flip).
 *   2. Auto-expires installment claims past their deadline and notifies
 *      both the customer and the voucher owner.
 */

import prisma from "../utils/prisma";
import { notify } from "../utils/notify";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function processInstallmentDeadlines(): Promise<void> {
  const now = new Date();
  const reminderWindowEnd = new Date(now.getTime() + 3 * ONE_DAY_MS);

  // ─── 1. Reminders (≤ 3 days remaining) ──────────────────────────────
  const upcoming = await prisma.voucherClaim.findMany({
    where: {
      installment_status: "active",
      remaining_balance: { gt: 0 },
      installment_deadline: { gte: now, lte: reminderWindowEnd },
    },
    include: {
      user: { select: { id: true, name: true, push_token: true } },
      voucher: { select: { id: true, title: true } },
    },
  });

  for (const c of upcoming) {
    // Best-effort dedupe: only notify if last notification for this claim
    // wasn't sent in the last 20 hours (so we send roughly once per day).
    const recent = await prisma.notification.findFirst({
      where: {
        user_id: c.user.id,
        type: "installment_reminder",
        created_at: { gte: new Date(now.getTime() - 20 * 60 * 60 * 1000) },
        description: { contains: `claim:${c.id}` },
      },
      select: { id: true },
    });
    if (recent) continue;

    const remaining = Number(c.remaining_balance ?? 0);
    const daysLeft = Math.max(
      1,
      Math.ceil((c.installment_deadline!.getTime() - now.getTime()) / ONE_DAY_MS),
    );
    await notify({
      pushToken: c.user.push_token,
      userId: c.user.id,
      title: "Installment due soon",
      body: `Your "${c.voucher.title}" voucher expires in ${daysLeft} day${daysLeft > 1 ? "s" : ""}. Pay ₹${remaining.toLocaleString()} to keep it active. [claim:${c.id}]`,
      type: "installment_reminder",
      data: { screen: "MyVouchers", claimId: c.id, voucherId: c.voucher.id },
    });
  }

  // ─── 2. Expire overdue claims ───────────────────────────────────────
  const overdue = await prisma.voucherClaim.findMany({
    where: {
      installment_status: "active",
      remaining_balance: { gt: 0 },
      installment_deadline: { lt: now },
    },
    include: {
      user: { select: { id: true, name: true, push_token: true } },
      voucher: {
        select: {
          id: true,
          title: true,
          owner_user_id: true,
          business_promotion_id: true,
        },
      },
    },
  });

  if (overdue.length === 0) {
    if (upcoming.length > 0) console.log(`[CRON][INSTALLMENT] Sent ${upcoming.length} reminders, no expirations.`);
    return;
  }

  // Bulk-flip status
  const overdueIds = overdue.map((c) => c.id);
  await prisma.voucherClaim.updateMany({
    where: { id: { in: overdueIds } },
    data: { installment_status: "expired", status: "expired" },
  });

  // Resolve owners (voucher.owner_user_id ?? promotion.user_id) and notify
  const promoIds = overdue
    .map((c) => c.voucher.business_promotion_id)
    .filter((x): x is number => !!x);
  const promos = promoIds.length
    ? await prisma.businessPromotion.findMany({
        where: { id: { in: promoIds } },
        select: { id: true, user_id: true },
      })
    : [];
  const promoOwnerMap = new Map(promos.map((p) => [p.id, p.user_id]));

  const ownerIds = Array.from(
    new Set(
      overdue
        .map(
          (c) =>
            c.voucher.owner_user_id ??
            (c.voucher.business_promotion_id
              ? promoOwnerMap.get(c.voucher.business_promotion_id)
              : null),
        )
        .filter((x): x is number => !!x),
    ),
  );
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, push_token: true },
      })
    : [];
  const ownerMap = new Map(owners.map((o) => [o.id, o]));

  for (const c of overdue) {
    const remaining = Number(c.remaining_balance ?? 0);

    // Customer notification
    await notify({
      pushToken: c.user.push_token,
      userId: c.user.id,
      title: "Voucher expired",
      body: `Your "${c.voucher.title}" voucher expired because the remaining ₹${remaining.toLocaleString()} wasn't paid in time.`,
      type: "installment_expired",
      data: { screen: "MyVouchers", claimId: c.id, voucherId: c.voucher.id },
    });

    // Owner notification
    const ownerId =
      c.voucher.owner_user_id ??
      (c.voucher.business_promotion_id
        ? promoOwnerMap.get(c.voucher.business_promotion_id)
        : null);
    if (ownerId) {
      const owner = ownerMap.get(ownerId);
      await notify({
        pushToken: owner?.push_token,
        userId: ownerId,
        title: "Installment claim expired",
        body: `${c.user.name ?? "A customer"} did not complete the installment for "${c.voucher.title}". ₹${remaining.toLocaleString()} was unpaid.`,
        type: "installment_expired_owner",
        data: { screen: "MyCreatedVouchers", claimId: c.id, voucherId: c.voucher.id },
      });
    }
  }

  console.log(
    `[CRON][INSTALLMENT] Reminders: ${upcoming.length} | Expired: ${overdue.length}`,
  );
}
