import { createEventPaymentIntent, registerForEvent, verifyRegistration } from '../controllers/eventController';
import prisma from '../utils/prisma';
import {
  createRazorpayOrder,
  fetchRazorpayOrder,
  getRazorpayPublicKey,
  verifyRazorpaySignature,
} from '../services/razorpayService';

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    event: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    eventRegistration: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/razorpayService', () => ({
  createRazorpayOrder: jest.fn(),
  fetchRazorpayOrder: jest.fn(),
  getRazorpayPublicKey: jest.fn(),
  verifyRazorpaySignature: jest.fn(),
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

describe('event payment controller', () => {
  const prismaMock = prisma as any;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.$transaction.mockImplementation(async (ops: Array<Promise<any>>) =>
      Promise.all(ops)
    );
    (getRazorpayPublicKey as jest.Mock).mockReturnValue('rzp_test_key');
    (verifyRazorpaySignature as jest.Mock).mockReturnValue(true);
  });

  it('creates payment intent for paid event', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      title: 'Tech Expo',
      status: 'active',
      ticket_price: 299,
      max_attendees: 100,
      attendee_count: 10,
    });
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null);
    (createRazorpayOrder as jest.Mock).mockResolvedValue({
      id: 'order_abc',
      amount: 29900,
      currency: 'INR',
    });

    const req: any = {
      params: { id: '7' },
      body: { ticket_count: 1 },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await createEventPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.body.order_id).toBe('order_abc');
    expect(res.body.key_id).toBe('rzp_test_key');
    expect(createRazorpayOrder).toHaveBeenCalled();
  });

  it('registers paid event after successful payment verification', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 299,
      max_attendees: 100,
      attendee_count: 10,
    });

    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    (fetchRazorpayOrder as jest.Mock).mockResolvedValue({
      id: 'order_abc',
      amount: 29900,
      currency: 'INR',
    });

    prismaMock.eventRegistration.create.mockResolvedValue({
      id: 50,
      event_id: 7,
      user_id: 123,
      qr_code: 'EVT-7-test',
      payment_status: 'paid',
    });
    prismaMock.event.update.mockResolvedValue({ id: 7 });

    const req: any = {
      params: { id: '7' },
      body: {
        ticket_count: 1,
        payment: {
          razorpay_order_id: 'order_abc',
          razorpay_payment_id: 'pay_abc',
          razorpay_signature: 'sig_abc',
        },
      },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await registerForEvent(req, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.body.payment_status).toBe('paid');
    expect(fetchRazorpayOrder).toHaveBeenCalledWith('order_abc');
    expect(prismaMock.eventRegistration.create).toHaveBeenCalled();
  });

  it('blocks paid registration when payment payload is missing', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 199,
      max_attendees: 100,
      attendee_count: 10,
    });
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null);

    const req: any = {
      params: { id: '7' },
      body: { ticket_count: 1 },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await registerForEvent(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Payment details are required/);
  });

  it('rejects invalid payment signature', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 100,
      max_attendees: 100,
      attendee_count: 0,
    });
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null);
    (verifyRazorpaySignature as jest.Mock).mockReturnValue(false);

    const req: any = {
      params: { id: '7' },
      body: {
        ticket_count: 1,
        payment: {
          razorpay_order_id: 'order_invalid',
          razorpay_payment_id: 'pay_invalid',
          razorpay_signature: 'bad_sig',
        },
      },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await registerForEvent(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid payment signature/);
  });

  it('rejects duplicate payment ID', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 100,
      max_attendees: 100,
      attendee_count: 0,
    });
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce(null) // not registered
      .mockResolvedValueOnce({ id: 99 }); // duplicate payment_id

    (verifyRazorpaySignature as jest.Mock).mockReturnValue(true);

    const req: any = {
      params: { id: '7' },
      body: {
        ticket_count: 1,
        payment: {
          razorpay_order_id: 'order_dup',
          razorpay_payment_id: 'pay_dup',
          razorpay_signature: 'sig_dup',
        },
      },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await registerForEvent(req, res as any);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Payment already used/);
  });

  it('rejects payment amount mismatch', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 100,
      max_attendees: 100,
      attendee_count: 0,
    });
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    (verifyRazorpaySignature as jest.Mock).mockReturnValue(true);
    (fetchRazorpayOrder as jest.Mock).mockResolvedValue({
      id: 'order_wrong',
      amount: 5000, // only 50 INR, but ticket is 100
      currency: 'INR',
    });

    const req: any = {
      params: { id: '7' },
      body: {
        ticket_count: 1,
        payment: {
          razorpay_order_id: 'order_wrong',
          razorpay_payment_id: 'pay_wrong',
          razorpay_signature: 'sig_wrong',
        },
      },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await registerForEvent(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Payment amount mismatch/);
  });

  it('rejects payment-intent for free events', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 0,
      max_attendees: 100,
      attendee_count: 0,
    });

    const req: any = {
      params: { id: '7' },
      body: { ticket_count: 1 },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await createEventPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Payment is not required/);
  });

  it('rejects payment-intent for full event', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 200,
      max_attendees: 10,
      attendee_count: 10,
    });

    const req: any = {
      params: { id: '7' },
      body: { ticket_count: 1 },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await createEventPaymentIntent(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Event is full/);
  });

  it('rejects registration for already registered user', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 0,
      max_attendees: 100,
      attendee_count: 5,
    });
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 42, event_id: 7, user_id: 123 });

    const req: any = {
      params: { id: '7' },
      body: { ticket_count: 1 },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await registerForEvent(req, res as any);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Already registered/);
  });

  it('allows free event registration without payment', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      status: 'active',
      ticket_price: 0,
      max_attendees: 100,
      attendee_count: 5,
    });
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null);
    prismaMock.eventRegistration.create.mockResolvedValue({
      id: 60,
      event_id: 7,
      user_id: 123,
      qr_code: 'EVT-7-free',
      payment_status: 'not_required',
    });
    prismaMock.event.update.mockResolvedValue({ id: 7 });

    const req: any = {
      params: { id: '7' },
      body: { ticket_count: 1 },
      user: { userId: 123, roles: ['consumer'] },
    };
    const res = createRes();

    await registerForEvent(req, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.body.payment_status).toBe('not_required');
  });
});

describe('verifyRegistration', () => {
  const prismaMock = prisma as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when qr_code is missing', async () => {
    const req: any = {
      body: {},
      user: { userId: 1, roles: ['business'] },
    };
    const res = createRes();

    await verifyRegistration(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/qr_code is required/);
  });

  it('returns 404 for unknown QR code', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null);

    const req: any = {
      body: { qr_code: 'EVT-unknown' },
      user: { userId: 1, roles: ['business'] },
    };
    const res = createRes();

    await verifyRegistration(req, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Registration not found/);
  });

  it('returns registration data for valid QR code', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue({
      id: 50,
      event_id: 7,
      qr_code: 'EVT-7-abc123',
      ticket_count: 1,
      payment_status: 'paid',
      amount_paid: 299,
      registered_at: '2026-04-13T10:00:00Z',
      user: { id: 123, name: 'Alex', phone: '+91 9876543210', profile_picture: null },
      event: { id: 7, title: 'Tech Expo', date: '2026-04-15', time: '10:00', location: 'Bangalore', business_id: 10 },
    });
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      business: { user_id: 1 },
    });

    const req: any = {
      body: { qr_code: 'EVT-7-abc123' },
      user: { userId: 1, roles: ['business'] },
    };
    const res = createRes();

    await verifyRegistration(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.registration_id).toBe(50);
    expect(res.body.payment_status).toBe('paid');
    expect(res.body.amount_paid).toBe(299);
    expect(res.body.user.name).toBe('Alex');
    expect(res.body.event.title).toBe('Tech Expo');
  });

  it('rejects verification by non-owner non-admin', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue({
      id: 50,
      event_id: 7,
      qr_code: 'EVT-7-abc123',
      ticket_count: 1,
      payment_status: 'paid',
      amount_paid: 299,
      registered_at: '2026-04-13T10:00:00Z',
      user: { id: 123, name: 'Alex', phone: '+91 9876543210', profile_picture: null },
      event: { id: 7, title: 'Tech Expo', date: '2026-04-15', time: '10:00', location: 'Bangalore', business_id: 10 },
    });
    prismaMock.event.findUnique.mockResolvedValue({
      id: 7,
      business: { user_id: 999 }, // different owner
    });

    const req: any = {
      body: { qr_code: 'EVT-7-abc123' },
      user: { userId: 1, roles: ['consumer'] }, // not owner and not admin
    };
    const res = createRes();

    await verifyRegistration(req, res as any);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Only the event organizer/);
  });
});
