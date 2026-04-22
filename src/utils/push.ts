/**
 * Expo Push Notification utility.
 * Sends push messages via the Expo Push API (FCM delivery for Android production).
 * Set EXPO_ACCESS_TOKEN in your environment for authenticated requests,
 * which bypasses rate limits and is required for production FCM delivery.
 */

export async function sendExpoPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!token || !token.startsWith("ExponentPushToken[")) return;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };

  if (process.env.EXPO_ACCESS_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: token,
        title,
        body,
        data,
        sound: "default",
        priority: "high",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[push] Expo push API error:", response.status, text);
    }
  } catch (err) {
    console.error("[push] Failed to send push notification:", err);
  }
}
