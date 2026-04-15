/**
 * Expo Push Notification utility.
 * Sends push messages via the Expo Push API (no expo-server-sdk required).
 */

export async function sendExpoPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!token || !token.startsWith('ExponentPushToken[')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: token, title, body, data }),
    });
  } catch (err) {
    console.error('[push] Failed to send push notification:', err);
  }
}
