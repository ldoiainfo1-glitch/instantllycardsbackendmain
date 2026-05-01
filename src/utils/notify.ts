/**
 * notify.ts
 *
 * Single helper that fires both an Expo push notification AND inserts an
 * in-app Notification row so the bell icon in the mobile app is populated.
 *
 * Both operations are best-effort (errors are swallowed); callers must NOT
 * rely on them for business logic.
 */

import prisma from "../utils/prisma";
import { sendExpoPushNotification } from "../utils/push";

interface NotifyOptions {
  /** Expo push token — may be null/undefined; push is skipped if missing */
  pushToken?: string | null;
  /** DB user_id — in-app row is skipped if missing */
  userId?: number | null;
  /** Notification title (shown in push banner and bell list) */
  title: string;
  /** Notification body / description */
  body: string;
  /** Semantic type stored on the DB row e.g. "event_registration" */
  type?: string;
  /** Extra data forwarded to the Expo push payload */
  data?: Record<string, unknown>;
}

/**
 * Fire a push notification and store an in-app notification row atomically
 * (both best-effort, non-blocking when awaited inside a catch block).
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  const { pushToken, userId, title, body, type, data } = opts;

  await Promise.allSettled([
    // 1. Expo push
    pushToken
      ? sendExpoPushNotification(pushToken, title, body, data)
      : Promise.resolve(),

    // 2. In-app DB row
    userId
      ? prisma.notification.create({
          data: {
            user_id: userId,
            title,
            description: body,
            type: type ?? "general",
            is_read: false,
          },
        })
      : Promise.resolve(),
  ]);
}
