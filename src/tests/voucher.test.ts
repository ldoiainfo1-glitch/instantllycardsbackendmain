import request from 'supertest';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import authRoutes from '../routes/auth';
import voucherRoutes from '../routes/vouchers';
import businessCardRoutes from '../routes/businessCards';
import prisma from '../utils/prisma';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/cards', businessCardRoutes);

const PHONE_A = `+9177${Date.now().toString().slice(-8)}`;
const PHONE_B = `+9166${Date.now().toString().slice(-8)}`;
let tokenA: string;
let tokenB: string;
let voucherId: number;
let cardId: number;

beforeAll(async () => {
  const [rA, rB] = await Promise.all([
    request(app).post('/api/auth/signup').send({ phone: PHONE_A, password: 'Test@1234' }),
    request(app).post('/api/auth/signup').send({ phone: PHONE_B, password: 'Test@1234' }),
  ]);
  tokenA = rA.body.accessToken;
  tokenB = rB.body.accessToken;

  // Create a card for userA to attach voucher
  const cardRes = await request(app)
    .post('/api/cards')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ full_name: 'Voucher Business', company_name: 'Voucher Co' });
  cardId = cardRes.body.id;

  // Seed a voucher directly
  const v = await prisma.voucher.create({
    data: {
      business_id: cardId,
      business_name: 'Voucher Co',
      title: 'Test Voucher',
      discount_type: 'percentage',
      discount_value: 10,
      status: 'active',
      max_claims: 100,
    },
  });
  voucherId = v.id;
}, 15000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { phone: { in: [PHONE_A, PHONE_B] } } });
  await prisma.$disconnect();
});

describe('GET /api/vouchers', () => {
  it('lists active vouchers', async () => {
    const res = await request(app).get('/api/vouchers');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

describe('POST /api/vouchers/:id/claim', () => {
  it('allows authenticated user to claim a voucher', async () => {
    const res = await request(app)
      .post(`/api/vouchers/${voucherId}/claim`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(201);
  });

  it('prevents double claiming', async () => {
    const res = await request(app)
      .post(`/api/vouchers/${voucherId}/claim`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(409);
  });

  it('requires authentication', async () => {
    const res = await request(app).post(`/api/vouchers/${voucherId}/claim`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/vouchers/transfer', () => {
  it('allows transfer to another user', async () => {
    const res = await request(app)
      .post('/api/vouchers/transfer')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ voucher_id: voucherId, recipient_phone: PHONE_B });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/vouchers/my', () => {
  it('returns claimed vouchers for user', async () => {
    const res = await request(app)
      .get('/api/vouchers/my')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
