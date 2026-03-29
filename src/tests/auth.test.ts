/**
 * Auth Tests
 * Note: These tests require a real test DB connection.
 * Set TEST_DATABASE_URL in .env.test or use the same DATABASE_URL with a test schema.
 * Run: npm test
 */
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import authRoutes from '../routes/auth';
import prisma from '../utils/prisma';
import { normalizePhone } from '../utils/phone';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);

const TS = Date.now().toString().slice(-7);
const TEST_PHONE = `+9199${TS}0`;
const TEST_PHONE_BIZ = `+9199${TS}1`;
const TEST_PHONE_PROMO = `+9199${TS}2`;
const NORMALIZED_PHONE = normalizePhone(TEST_PHONE);
const TEST_PASSWORD = 'Test@1234';

let accessToken: string;
let refreshToken: string;

afterAll(async () => {
  // Cleanup test users
  await prisma.user.deleteMany({
    where: { phone: { in: [normalizePhone(TEST_PHONE), normalizePhone(TEST_PHONE_BIZ), normalizePhone(TEST_PHONE_PROMO)] } },
  });
  await prisma.$disconnect();
});

describe('POST /api/auth/signup', () => {
  it('creates a customer user by default (no role param)', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
      name: 'Test User',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.roles).toEqual(['customer']);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('creates a customer user when role=customer is explicit', async () => {
    const phone = `+9199${TS}9`;
    const res = await request(app).post('/api/auth/signup').send({
      phone,
      password: TEST_PASSWORD,
      name: 'Customer Only',
      role: 'customer',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.roles).toEqual(['customer']);
    await prisma.user.deleteMany({ where: { phone: normalizePhone(phone) } });
  });

  it('creates a business user when role=business', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      phone: TEST_PHONE_BIZ,
      password: TEST_PASSWORD,
      name: 'Business Owner',
      role: 'business',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.roles).toEqual(['business']);
  });

  it('rejects invalid role value', async () => {
    const phone = `+9199${TS}8`;
    const res = await request(app).post('/api/auth/signup').send({
      phone,
      password: TEST_PASSWORD,
      name: 'Bad Role',
      role: 'admin',
    });
    expect(res.status).toBe(422);
  });

  it('rejects duplicate phone', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(409);
  });

  it('validates required fields', async () => {
    const res = await request(app).post('/api/auth/signup').send({ phone: TEST_PHONE });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.roles).toEqual(['customer']);
  });

  it('customer without promotion gets only customer role on login', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.roles).not.toContain('business');
    expect(res.body.user.roles).toContain('customer');
  });

  it('customer with active business promotion gets dual roles on login', async () => {
    // Create a fresh customer and inject an active promotion record
    const promoRes = await request(app).post('/api/auth/signup').send({
      phone: TEST_PHONE_PROMO,
      password: TEST_PASSWORD,
      name: 'Promo Customer',
      role: 'customer',
    });
    expect(promoRes.status).toBe(201);
    const userId = promoRes.body.user.id;

    // Manually create an active BusinessPromotion record for this user
    await prisma.businessPromotion.create({
      data: {
        user_id: userId,
        business_name: 'Test Business',
        owner_name: 'Promo Customer',
        listing_type: 'free',
        status: 'active',
        is_active: true,
      },
    });

    const loginRes = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE_PROMO,
      password: TEST_PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.roles).toContain('customer');
    expect(loginRes.body.user.roles).toContain('business');
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: 'wrong',
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('returns new tokens with valid refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    // Update tokens for subsequent tests
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('rejects invalid refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'bad.token' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns current user with valid access token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(NORMALIZED_PHONE);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
