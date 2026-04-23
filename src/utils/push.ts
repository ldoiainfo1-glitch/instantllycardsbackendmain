/**
 * Expo Push Notification utility.
 * Sends push messages via the Expo Push API (FCM delivery for Android production).
 * Supports batched sending (up to 100 per request) and push receipt checking
 * with automatic stale token cleanup.
 *
 * Requires EXPO_ACCESS_TOKEN in environment for authenticated requests —
 * this bypasses rate limits and is required for production FCM delivery.
 */

import prisma from "../prismaClient";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";
const BATCH_SIZE = 100;

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }
  return headers;
}

function isValidExpoToken(token: string): boolean {
  return typeof token === "string" && token.startsWith("ExponentPushToken[");
}

interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/** Store pending receipt IDs so the receipt-check job can process them. */
async function storePendingReceipts(
  tickets: ExpoPushTicket[],
  tokens: string[],
): Promise<void> {
  try {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === "ok" && ticket.id) {
        // Store receipt ID mapped to the token so we can clean up stale tokens later.
        await prisma.pushReceipt
          .create({
            data: {
              receipt_id: ticket.id,
              push_token: tokens[i],
              created_at: new Date(),
            },
          })
          .catch(() => {}); // Non-blocking
      } else if (ticket.status === "error") {
        const errCode = ticket.details?.error;
        if (errCode === "DeviceNotRegistered") {
          // Token is invalid right now — clear it immediately.
          await prisma.user
            .updateMany({
              where: { push_token: tokens[i] },
              data: { push_token: null, push_token_updated_at: new Date() },
            })
            .catch(() => {});
          console.warn(
            `[push] Cleared stale token (immediate): ${tokens[i].slice(0, 40)}...`,
          );
        } else {
          console.warn(
            `[push] Ticket error for token ${tokens[i].slice(0, 40)}...: ${ticket.message}`,
          );
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Send a batch of push notifications in one HTTP call (up to 100).
 * Internal — use sendExpoPushNotification for single sends or
 * sendExpoPushNotificationBatch for multiple.
 */
async function sendBatch(messages: PushMessage[]): Promise<void> {
  const payload = messages.map((m) => ({
    to: m.token,
    title: m.title,
    body: m.body,
    data: m.data,
    sound: "default",
    priority: "high",
    channelId: m.channelId ?? "default",
  }));

  try {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[push] Expo push API error:", response.status, text);
      return;
    }

    const result = (await response.json()) as { data: ExpoPushTicket[] };
    const tickets: ExpoPushTicket[] = result.data ?? [];
    const tokens = messages.map((m) => m.token);
    await storePendingReceipts(tickets, tokens);
  } catch (err) {
    console.error("[push] Failed to send push notification batch:", err);
  }
}

/**
 * Send a single push notification.
 * Validates the token format before sending.
 */
export async function sendExpoPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId?: string,
): Promise<void> {
  if (!isValidExpoToken(token)) return;
  await sendBatch([{ token, title, body, data, channelId }]);
}

/**
 * Send push notifications to multiple recipients in batches of 100.
 * More efficient than calling sendExpoPushNotification in a loop.
 */
export async function sendExpoPushNotificationBatch(
  messages: PushMessage[],
): Promise<void> {
  const valid = messages.filter((m) => isValidExpoToken(m.token));
  if (valid.length === 0) return;

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    await sendBatch(valid.slice(i, i + BATCH_SIZE));
  }
}

/**
 * Check push receipts from Expo and clean up DeviceNotRegistered tokens.
 * Should be called periodically (e.g. every 30 minutes via cron).
 */
export async function checkPushReceipts(): Promise<void> {
  let pendingReceipts: { receipt_id: string; push_token: string }[] = [];

  try {
    pendingReceipts = await prisma.pushReceipt.findMany({
      take: 300, // Expo allows up to 300 receipt IDs per request
    });
  } catch (err) {
    console.error("[push] Failed to fetch pending receipts:", err);
    return;
  }

  if (pendingReceipts.length === 0) return;

  const receiptIds = pendingReceipts.map((r) => r.receipt_id);

  try {
    const response = await fetch(EXPO_RECEIPTS_ENDPOINT, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ ids: receiptIds }),
    });

    if (!response.ok) {
      console.error("[push] Receipt check API error:", response.status);
      return;
    }

    const result = (await response.json()) as {
      data: Record<string, ExpoReceipt>;
    };
    const receipts = result.data ?? {};

    for (const pending of pendingReceipts) {
      const receipt = receipts[pending.receipt_id];
      if (!receipt) continue;

      if (receipt.status === "error") {
        const errCode = receipt.details?.error;
        if (errCode === "DeviceNotRegistered") {
          // Clear stale push token from user record
          await prisma.user
            .updateMany({
              where: { push_token: pending.push_token },
              data: { push_token: null, push_token_updated_at: new Date() },
            })
            .catch(() => {});
          console.warn(
            `[push] Cleared stale token (receipt): ${pending.push_token.slice(0, 40)}...`,
          );
        } else {
          console.warn(`[push] Receipt error (${errCode}): ${receipt.message}`);
        }
      }

      // Delete the processed receipt
      await prisma.pushReceipt
        .delete({ where: { receipt_id: pending.receipt_id } })
        .catch(() => {});
    }
  } catch (err) {
    console.error("[push] Failed to check push receipts:", err);
  }
}
