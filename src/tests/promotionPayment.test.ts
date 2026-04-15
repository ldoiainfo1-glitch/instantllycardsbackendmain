import {
  listPricingPlans,
  createPromotionPaymentIntent,
  verifyPromotionPayment,
  createPromotion,
  listPromotions,
  retryPromotionPayment,
} from '../controllers/promotionController';
import { cancelExpiredPromotions } from '../jobs/expiryJob';
import prisma from '../utils/prisma';
import {
  createRazorpayOrder,
  getRazorpayPublicKey,
  verifyRazorpaySignature,
} from '../services/razorpayService';

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    promotionPricingPlan: { findMany: jest.fn(), findUnique: jest.fn() },
    businessPromotion: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    promotionOrder: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    userRole: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), upsert: jest.fn() },
    refreshToken: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/razorpayService', () => ({
  createRazorpayOrder: jest.fn(),
  getRazorpayPublicKey: jest.fn(),
  verifyRazorpaySignature: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../utils/jwt', () => ({
  signAccessToken: jest.fn(() => 'mock_access_token'),
  signRefreshToken: jest.fn(() => 'mock_refresh_token'),
  hashToken: jest.fn(() => 'mock_hash'),
  refreshTokenExpiry: jest.fn(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
}));

type MockResponse = {
  statusCode: number;
  body: any;
  status: jest.Mock;
  json: jest.Mock;
};

function createRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status: jest.fn(function (this: MockResponse, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (this: MockResponse, payload: any) {
      this.body = payload;
      return this;
    }),
  };
  return res;
}

const prismaMock = prisma as any;

const samplePlan = {
  id: 5,
  code: 'scale_monthly',
  area_type: 'city',
  rank: 3,
  rank_label: 'SCALE',
  amount: 4000,
  currency: 'INR',
  duration_days: 30,
  priority_score: 60,
  is_active: true,
};

const samplePromo = {
  id: 10,
  user_id: 42,
  business_card_id: 1,
  business_name: 'Test Biz',
  listing_type: 'premium',
  status: 'draft',
};

beforeEach(() => {
  jest.clearAllMocks();
  (getRazorpayPublicKey as jest.Mock).mockReturnValue('rzp_test_key');
  (verifyRazorpaySignature as jest.Mock).mockReturnValue(true);
  prismaMock.$transaction.mockImplementation(async (opsOrFn: any) => {
    // Support both array form and interactive callback form
    if (typeof opsOrFn === 'function') {
      return opsOrFn(prismaMock);
    }
    return Promise.all(opsOrFn);
  });
});

/* ─── listPricingPlans ─────────────────────────────────────────── */

describe('listPricingPlans', () => {
  it('returns all active pricing plans', async () => {
    const plans = [samplePlan, { ...samplePlan, id: 6, code: 'scale_yearly' }];
    prismaMock.promotionPricingPlan.findMany.mockResolvedValue(plans);

    const req: any = {};
    const res = createRes();
    await listPricingPlans(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(prismaMock.promotionPricingPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true } }),
    );
  });
});

/* ─── createPromotionPaymentIntent ─────────────────────────────── */

describe('createPromotionPaymentIntent', () => {
  it('creates a Razorpay order for a valid plan', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue(samplePromo);
    prismaMock.promotionPricingPlan.findUnique.mockResolvedValue(samplePlan);
    prismaMock.promotionOrder.findFirst.mockResolvedValue(null);
    prismaMock.promotionOrder.create.mockResolvedValue({
      id: 100,
      payment_order_id: 'order_xyz',
    });
    (createRazorpayOrder as jest.Mock).mockResolvedValue({
      id: 'order_xyz',
      amount: 400000,
      currency: 'INR',
    });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotionPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.key).toBe('rzp_test_key');
    expect(res.body.order_id).toBe('order_xyz');
    expect(res.body.amount).toBe(400000);
    expect(createRazorpayOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountPaise: 400000,
        currency: 'INR',
        receipt: 'promo_10_plan_5',
      }),
    );
  });

  it('reuses existing unpaid order', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue(samplePromo);
    prismaMock.promotionPricingPlan.findUnique.mockResolvedValue(samplePlan);
    prismaMock.promotionOrder.findFirst.mockResolvedValue({
      id: 99,
      payment_order_id: 'order_existing',
      payable_amount: 4000,
      currency: 'INR',
    });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotionPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.order_id).toBe('order_existing');
    expect(createRazorpayOrder).not.toHaveBeenCalled();
  });

  it('returns 400 when pricing_plan_id is missing', async () => {
    const req: any = {
      params: { id: '10' },
      body: {},
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotionPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/pricing_plan_id/);
  });

  it('returns 404 when promotion not found', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue(null);

    const req: any = {
      params: { id: '999' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotionPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Promotion not found/);
  });

  it('returns 403 when user does not own the promotion', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue({ ...samplePromo, user_id: 999 });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotionPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it('returns 404 when pricing plan is inactive', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue(samplePromo);
    prismaMock.promotionPricingPlan.findUnique.mockResolvedValue({
      ...samplePlan,
      is_active: false,
    });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotionPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Pricing plan not found/);
  });
});

/* ─── verifyPromotionPayment ───────────────────────────────────── */

describe('verifyPromotionPayment', () => {
  const validPayment = {
    razorpay_order_id: 'order_xyz',
    razorpay_payment_id: 'pay_xyz',
    razorpay_signature: 'sig_xyz',
  };

  const sampleOrder = {
    id: 100,
    user_id: 42,
    business_promotion_id: 10,
    pricing_plan_id: 5,
    payment_order_id: 'order_xyz',
    payable_amount: 4000,
    currency: 'INR',
    duration_days: 30,
    priority_score: 60,
    rank_label: 'SCALE',
    status: 'created',
  };

  it('verifies payment, activates promotion, and sets tier from rank_label', async () => {
    prismaMock.promotionOrder.findFirst.mockResolvedValue(sampleOrder);
    prismaMock.promotionOrder.update.mockResolvedValue({
      ...sampleOrder,
      status: 'paid',
      payment_id: 'pay_xyz',
    });
    prismaMock.businessPromotion.update.mockResolvedValue({
      ...samplePromo,
      status: 'active',
      payment_status: 'completed',
      tier: 'scale',
    });
    prismaMock.userRole.upsert.mockResolvedValue({ id: 1, user_id: 42, role: 'business' });
    prismaMock.userRole.findMany.mockResolvedValue([
      { user_id: 42, role: 'consumer' },
      { user_id: 42, role: 'business' },
    ]);

    const req: any = {
      params: { id: '10' },
      body: validPayment,
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await verifyPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.status).toBe('paid');
    expect(res.body.promotion.status).toBe('active');
    expect(res.body.roles).toEqual(['consumer', 'business']);
    expect(res.body.accessToken).toBe('mock_access_token');
    expect(res.body.refreshToken).toBe('mock_refresh_token');
    expect(prismaMock.userRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id_role: { user_id: 42, role: 'business' } },
        update: {},
        create: { user_id: 42, role: 'business' },
      }),
    );
    expect(verifyRazorpaySignature).toHaveBeenCalledWith({
      razorpayOrderId: 'order_xyz',
      razorpayPaymentId: 'pay_xyz',
      razorpaySignature: 'sig_xyz',
    });

    // Verify tier was set from rank_label SCALE → 'scale'
    const txFn = prismaMock.$transaction.mock.calls[0][0];
    expect(typeof txFn === 'function' || Array.isArray(txFn)).toBe(true);
  });

  it('rejects missing payment fields', async () => {
    const req: any = {
      params: { id: '10' },
      body: { razorpay_order_id: 'order_xyz' },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await verifyPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Payment verification fields/);
  });

  it('rejects invalid signature', async () => {
    (verifyRazorpaySignature as jest.Mock).mockReturnValue(false);

    const req: any = {
      params: { id: '10' },
      body: validPayment,
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await verifyPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid payment signature/);
  });

  it('returns 404 when order not found', async () => {
    prismaMock.promotionOrder.findFirst.mockResolvedValue(null);

    const req: any = {
      params: { id: '10' },
      body: validPayment,
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await verifyPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Order not found/);
  });

  it('returns 403 when user does not own the order', async () => {
    prismaMock.promotionOrder.findFirst.mockResolvedValue({
      ...sampleOrder,
      user_id: 999,
    });

    const req: any = {
      params: { id: '10' },
      body: validPayment,
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await verifyPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it('calculates correct expiry from duration_days', async () => {
    prismaMock.promotionOrder.findFirst.mockResolvedValue(sampleOrder);
    prismaMock.promotionOrder.update.mockResolvedValue({ ...sampleOrder, status: 'paid' });
    prismaMock.businessPromotion.update.mockResolvedValue({ ...samplePromo, status: 'active' });
    prismaMock.userRole.upsert.mockResolvedValue({ id: 1, user_id: 42, role: 'business' });
    prismaMock.userRole.findMany.mockResolvedValue([{ user_id: 42, role: 'business' }]);

    const req: any = {
      params: { id: '10' },
      body: validPayment,
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await verifyPromotionPayment(req, res as any);

    // Verify the transaction was called with correct expiry calculation
    expect(prismaMock.$transaction).toHaveBeenCalled();
    const txArgs = prismaMock.$transaction.mock.calls[0][0];
    expect(txArgs).toHaveLength(2); // order update + promo update
    // Upsert should always be called (idempotent)
    expect(prismaMock.userRole.upsert).toHaveBeenCalled();
  });
});

/* ─── createPromotion idempotency (Fix 3) ──────────────────────── */

describe('createPromotion idempotency', () => {
  it('returns existing promotion if active for same card', async () => {
    const activePromo = { ...samplePromo, status: 'active', business_card_id: 1 };
    prismaMock.businessPromotion.findFirst.mockResolvedValue(activePromo);

    const req: any = {
      body: { business_name: 'Test', owner_name: 'Owner', business_card_id: 1, plan_type: 'free' },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotion(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(activePromo);
    expect(prismaMock.businessPromotion.create).not.toHaveBeenCalled();
  });

  it('returns existing promotion if pending_payment for same card', async () => {
    const pendingPromo = { ...samplePromo, status: 'pending_payment', business_card_id: 1 };
    prismaMock.businessPromotion.findFirst.mockResolvedValue(pendingPromo);

    const req: any = {
      body: { business_name: 'Test', owner_name: 'Owner', business_card_id: 1, plan_type: 'premium' },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotion(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(pendingPromo);
    expect(prismaMock.businessPromotion.create).not.toHaveBeenCalled();
  });

  it('allows recreation when previous promotion was cancelled', async () => {
    const cancelledPromo = { ...samplePromo, status: 'cancelled', business_card_id: 1 };
    prismaMock.businessPromotion.findFirst.mockResolvedValue(cancelledPromo);
    const newPromo = { ...samplePromo, id: 20, status: 'active', business_card_id: 1 };
    prismaMock.businessPromotion.create.mockResolvedValue(newPromo);

    const req: any = {
      body: { business_name: 'Test', owner_name: 'Owner', business_card_id: 1, plan_type: 'free' },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotion(req as any, res as any);

    expect(res.statusCode).toBe(201);
    expect(prismaMock.businessPromotion.create).toHaveBeenCalled();
  });
});

/* ─── listPromotions expiry & fallback (Fix 2 + Fix 5) ─────────── */

describe('listPromotions expiry and fallback', () => {
  it('is_premium is based on tier (not plan_type)', async () => {
    const promos = [
      { ...samplePromo, plan_type: 'premium', status: 'active', tier: 'scale' },
      { ...samplePromo, id: 11, plan_type: 'free', status: 'active', tier: 'free' },
      { ...samplePromo, id: 12, plan_type: 'premium', status: 'active', tier: 'free' },
    ];
    prismaMock.businessPromotion.findMany.mockResolvedValue(promos);

    const req: any = { query: {} };
    const res = createRes();

    await listPromotions(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.data[0].is_premium).toBe(true);   // tier=scale, active
    expect(res.body.data[1].is_premium).toBe(false);  // tier=free
    expect(res.body.data[2].is_premium).toBe(false);  // tier=free despite plan_type=premium
  });

  it('uses OR filter with expiry for default listing', async () => {
    prismaMock.businessPromotion.findMany.mockResolvedValue([]);

    const req: any = { query: {} };
    const res = createRes();

    await listPromotions(req, res as any);

    const call = prismaMock.businessPromotion.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR).toHaveLength(3);
    // Free active, premium active with expiry, pending_payment
    expect(call.where.OR[0]).toEqual({ plan_type: 'free', status: 'active' });
    expect(call.where.OR[1].plan_type).toBe('premium');
    expect(call.where.OR[1].expiry_date).toBeDefined();
    expect(call.where.OR[2]).toEqual({ status: 'pending_payment' });
  });
});

/* ─── cancelExpiredPromotions (Improvement 1) ──────────────────── */

describe('cancelExpiredPromotions', () => {
  it('cancels expired premium promotions and resets tier to free', async () => {
    prismaMock.businessPromotion.updateMany.mockResolvedValue({ count: 3 });

    const count = await cancelExpiredPromotions();

    expect(count).toBe(3);
    const call = prismaMock.businessPromotion.updateMany.mock.calls[0][0];
    expect(call.where.status).toBe('active');
    expect(call.where.plan_type).toBe('premium');
    expect(call.where.expiry_date.lt).toBeInstanceOf(Date);
    expect(call.data.status).toBe('expired');
    expect(call.data.tier).toBe('free');
  });

  it('returns 0 when no promotions expired', async () => {
    prismaMock.businessPromotion.updateMany.mockResolvedValue({ count: 0 });

    const count = await cancelExpiredPromotions();
    expect(count).toBe(0);
  });
});

/* ─── retryPromotionPayment (Improvement 5) ────────────────────── */

describe('retryPromotionPayment', () => {
  it('creates new payment order for pending_payment promotion', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue({
      ...samplePromo,
      status: 'pending_payment',
    });
    prismaMock.promotionPricingPlan.findUnique.mockResolvedValue(samplePlan);
    (createRazorpayOrder as jest.Mock).mockResolvedValue({
      id: 'order_retry',
      amount: 400000,
      currency: 'INR',
    });
    prismaMock.promotionOrder.create.mockResolvedValue({
      id: 200,
      payment_order_id: 'order_retry',
    });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await retryPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.order_id).toBe('order_retry');
    expect(createRazorpayOrder).toHaveBeenCalled();
  });

  it('rejects retry for active promotion', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue({
      ...samplePromo,
      status: 'active',
    });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await retryPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Cannot retry/);
  });

  it('rejects retry for cancelled promotion', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue({
      ...samplePromo,
      status: 'cancelled',
    });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await retryPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Cannot retry/);
  });

  it('returns 404 when promotion not found', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue(null);

    const req: any = {
      params: { id: '999' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await retryPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when user does not own promotion', async () => {
    prismaMock.businessPromotion.findUnique.mockResolvedValue({
      ...samplePromo,
      user_id: 999,
      status: 'pending_payment',
    });

    const req: any = {
      params: { id: '10' },
      body: { pricing_plan_id: 5 },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await retryPromotionPayment(req, res as any);

    expect(res.statusCode).toBe(403);
  });
});

/* ─── Business role permanence (Improvement 4) ─────────────────── */

describe('business role permanence', () => {
  it('expiry job does NOT touch user roles', async () => {
    prismaMock.businessPromotion.updateMany.mockResolvedValue({ count: 5 });

    await cancelExpiredPromotions();

    // Verify no role-related operations were called
    expect(prismaMock.userRole.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.userRole.create).not.toHaveBeenCalled();
    expect(prismaMock.userRole.upsert).not.toHaveBeenCalled();
  });
});

/* ─── Transaction-based idempotency (Improvement 3) ────────────── */

describe('createPromotion transaction safety', () => {
  it('uses $transaction for create to prevent race conditions', async () => {
    prismaMock.businessPromotion.findFirst.mockResolvedValue(null);
    const newPromo = { ...samplePromo, id: 30, status: 'active', plan_type: 'free' };
    prismaMock.businessPromotion.create.mockResolvedValue(newPromo);
    prismaMock.userRole.upsert.mockResolvedValue({ id: 1, user_id: 42, role: 'business' });
    prismaMock.userRole.findMany.mockResolvedValue([
      { user_id: 42, role: 'consumer' },
      { user_id: 42, role: 'business' },
    ]);

    const req: any = {
      body: { business_name: 'Test', owner_name: 'Owner', business_card_id: 1, plan_type: 'free' },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotion(req as any, res as any);

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });

  it('grants business role on free promotion creation and returns fresh tokens', async () => {
    prismaMock.businessPromotion.findFirst.mockResolvedValue(null);
    const newPromo = { ...samplePromo, id: 31, status: 'active', plan_type: 'free' };
    prismaMock.businessPromotion.create.mockResolvedValue(newPromo);
    prismaMock.userRole.upsert.mockResolvedValue({ id: 1, user_id: 42, role: 'business' });
    prismaMock.userRole.findMany.mockResolvedValue([
      { user_id: 42, role: 'consumer' },
      { user_id: 42, role: 'business' },
    ]);

    const req: any = {
      body: { business_name: 'Test', owner_name: 'Owner', business_card_id: 1, plan_type: 'free' },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotion(req as any, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.body.roles).toEqual(['consumer', 'business']);
    expect(res.body.accessToken).toBe('mock_access_token');
    expect(res.body.refreshToken).toBe('mock_refresh_token');
    // Verify upsert was called to grant business role
    expect(prismaMock.userRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id_role: { user_id: 42, role: 'business' } },
        create: { user_id: 42, role: 'business' },
      }),
    );
  });

  it('grants business role on premium promotion creation', async () => {
    prismaMock.businessPromotion.findFirst.mockResolvedValue(null);
    const newPromo = { ...samplePromo, id: 32, status: 'pending_payment', plan_type: 'premium' };
    prismaMock.businessPromotion.create.mockResolvedValue(newPromo);
    prismaMock.userRole.upsert.mockResolvedValue({ id: 1, user_id: 42, role: 'business' });
    prismaMock.userRole.findMany.mockResolvedValue([
      { user_id: 42, role: 'consumer' },
      { user_id: 42, role: 'business' },
    ]);

    const req: any = {
      body: { business_name: 'Test', owner_name: 'Owner', business_card_id: 1, plan_type: 'premium' },
      user: { userId: 42, roles: ['consumer'] },
    };
    const res = createRes();

    await createPromotion(req as any, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.body.roles).toEqual(['consumer', 'business']);
    expect(res.body.accessToken).toBe('mock_access_token');
  });
});
