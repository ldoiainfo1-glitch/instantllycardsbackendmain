/**
 * OTP utility with Fast2SMS integration
 * Get your API key from: https://www.fast2sms.com/dashboard/dev-api
 */

interface OTPEntry {
  phone: string;
  otp: string;
  expiresAt: Date;
}

// In-memory storage for development
// TODO: Move to Redis or database for production
const otpStore = new Map<string, OTPEntry>();

const OTP_EXPIRY_MINUTES = 10;
const IS_PROD = process.env.NODE_ENV === 'production';
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || '';
const FAST2SMS_SENDER_ID = process.env.FAST2SMS_SENDER_ID || 'FSTSMS'; // Default sender ID

// Test mode: Only enabled explicitly via OTP_TEST_MODE=true in .env
const TEST_MODE = process.env.OTP_TEST_MODE === 'true';
const TEST_OTP = '123456';

/**
 * Generate a 6-digit OTP
 */
export function generateOTP(): string {
  // In test mode, always return the test OTP for easy testing
  if (TEST_MODE) {
    return TEST_OTP;
  }
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Store OTP for a phone number
 */
export function storeOTP(phone: string, otp: string): void {
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  otpStore.set(phone, { phone, otp, expiresAt });
  if (!IS_PROD) console.log(`[OTP] Stored for ${phone}: ${otp} (expires: ${expiresAt.toISOString()})`);
}

/**
 * Verify OTP for a phone number
 * @param consume - if true (default), deletes the OTP after verification (one-time use)
 */
export function verifyOTP(phone: string, otp: string, consume = true): boolean {
  // Test mode: accept hardcoded OTP for easy UI testing
  if (TEST_MODE && otp === TEST_OTP) {
    if (!IS_PROD) console.log(`[OTP] ✅ Test mode: Accepting test OTP ${TEST_OTP} for ${phone}`);
    return true;
  }

  const entry = otpStore.get(phone);
  
  if (!entry) {
    if (!IS_PROD) console.log(`[OTP] No OTP found for ${phone}`);
    return false;
  }

  if (entry.expiresAt < new Date()) {
    otpStore.delete(phone);
    if (!IS_PROD) console.log(`[OTP] Expired for ${phone}`);
    return false;
  }

  if (entry.otp !== otp) {
    if (!IS_PROD) console.log(`[OTP] Invalid OTP for ${phone}: expected ${entry.otp}, got ${otp}`);
    return false;
  }

  if (consume) {
    otpStore.delete(phone);
    if (!IS_PROD) console.log(`[OTP] Verified and removed for ${phone}`);
  } else {
    if (!IS_PROD) console.log(`[OTP] Verified (not consumed) for ${phone}`);
  }
  return true;
}

/**
 * Send OTP via Fast2SMS
 * API Documentation: https://www.fast2sms.com/dashboard/dev-api
 */
export async function sendOTP(phone: string, otp: string): Promise<void> {
  // Format phone number (Fast2SMS requires 10 digits without country code)
  let phoneNumber = phone;
  if (phone.startsWith('91')) {
    phoneNumber = phone.substring(2); // Remove +91 or 91 prefix
  }
  if (phone.startsWith('+91')) {
    phoneNumber = phone.substring(3);
  }

  const message = `${otp} is your OTP for Instantlly password reset. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share with anyone.`;

  // No API key: just log OTP to console
  if (!FAST2SMS_API_KEY) {
    console.log('[OTP] DEV MODE SMS to ' + phoneNumber);
    console.log('[OTP] Your OTP is: ' + otp);
    if (TEST_MODE) {
      console.log('[OTP] TEST MODE: You can also use OTP "123456" for any phone number');
    }
    console.log('[OTP] Set FAST2SMS_API_KEY in .env to enable real SMS');
    return;
  }

  // Send actual SMS via Fast2SMS (works in both dev and production)
  try {
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': FAST2SMS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        route: 'v3',
        sender_id: FAST2SMS_SENDER_ID,
        message: message,
        language: 'english',
        flash: 0,
        numbers: phoneNumber,
      }),
    });

    const responseText = await response.text();
    console.log(`[OTP] Fast2SMS raw response (${response.status}):`, responseText);
    if (!responseText) {
      throw new Error('Empty response from Fast2SMS');
    }
    const data = JSON.parse(responseText);

    if (!response.ok || !data.return) {
      console.error(`[OTP] Fast2SMS error:`, data);
      throw new Error(data.message || 'Failed to send SMS');
    }

    console.log(`[OTP] SMS sent successfully to ${phoneNumber} via Fast2SMS. Message ID: ${data.request_id}`);
  } catch (error: any) {
    console.error(`[OTP] Failed to send SMS via Fast2SMS:`, error);
    // In production, you might want to fallback to logging or throw error
    // For now, we'll log it but not fail the request
    console.log(`[OTP] FALLBACK - OTP for ${phoneNumber}: ${otp}`);
  }
}

/**
 * Clean up expired OTPs (optional maintenance function)
 */
export function cleanupExpiredOTPs(): void {
  const now = new Date();
  for (const [phone, entry] of otpStore.entries()) {
    if (entry.expiresAt < now) {
      otpStore.delete(phone);
    }
  }
}
