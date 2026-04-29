import crypto from 'crypto';

const Razorpay = require('razorpay');

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status?: string;
  notes?: Record<string, string>;
};

let razorpayClient: any | null = null;

function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID_TEST || process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET_TEST || process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are not configured');
  }

  return { keyId, keySecret };
}

function getRazorpayClient() {
  if (razorpayClient) return razorpayClient;

  const { keyId, keySecret } = getRazorpayConfig();
  razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayClient;
}

export function getRazorpayPublicKey(): string {
  return getRazorpayConfig().keyId;
}

export async function createRazorpayOrder(params: {
  amountPaise: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount: params.amountPaise,
    currency: params.currency || 'INR',
    receipt: params.receipt,
    notes: params.notes || {},
  });

  return order as RazorpayOrder;
}

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrder> {
  const client = getRazorpayClient();
  const order = await client.orders.fetch(orderId);
  return order as RazorpayOrder;
}

export function verifyRazorpaySignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): boolean {
  const { keySecret } = getRazorpayConfig();
  const payload = `${input.razorpayOrderId}|${input.razorpayPaymentId}`;
  const digest = crypto
    .createHmac('sha256', keySecret)
    .update(payload)
    .digest('hex');

  return digest === input.razorpaySignature;
}

/**
 * Phase 5 — Refund a captured payment.
 * Returns Razorpay refund object on success.
 */
export async function refundRazorpayPayment(params: {
  paymentId: string;
  amountPaise?: number;        // omit for full refund
  notes?: Record<string, string>;
  speed?: 'normal' | 'optimum';
}): Promise<{
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
}> {
  const client = getRazorpayClient();
  const body: any = { speed: params.speed || 'normal' };
  if (params.amountPaise !== undefined) body.amount = params.amountPaise;
  if (params.notes) body.notes = params.notes;
  const refund = await client.payments.refund(params.paymentId, body);
  return refund;
}

/**
 * Phase 5 — Verify a Razorpay webhook signature.
 * Razorpay sends the signature in `X-Razorpay-Signature`. The expected
 * value is HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET).
 *
 * IMPORTANT: caller must pass the EXACT raw request body string.
 * If body has been parsed by express.json() the signature WILL FAIL.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secret =
    process.env.RAZORPAY_WEBHOOK_SECRET_TEST ||
    process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('Razorpay webhook secret not configured');
  }
  if (!signature) return false;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // timing-safe compare
  try {
    const a = Buffer.from(digest, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
