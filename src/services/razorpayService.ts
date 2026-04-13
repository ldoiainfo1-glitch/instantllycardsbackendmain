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
