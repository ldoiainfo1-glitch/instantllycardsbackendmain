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
const TEST_PHONE_PWD = `+9199${TS}3`;
const NORMALIZED_PHONE = normalizePhone(TEST_PHONE);
const TEST_PASSWORD = 'Test@1234';

let accessToken: string;
let refreshToken: string;

afterAll(async () => {
  // Cleanup test users
  await prisma.user.deleteMany({
    where: { phone: { in: [normalizePhone(TEST_PHONE), normalizePhone(TEST_PHONE_BIZ), normalizePhone(TEST_PHONE_PROMO), normalizePhone(TEST_PHONE_PWD)] } },
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

  it('customer with active business promotion keeps customer role on login (role granted on payment)', async () => {
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
      },
    });

    // Login should NOT auto-grant business role (role is granted only on payment verification)
    const loginRes = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE_PROMO,
      password: TEST_PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.roles).toContain('customer');
    // Business role is NOT auto-granted on login anymore
    expect(loginRes.body.user.roles).not.toContain('business');
  });

  it('login response does not contain legacy businessApprovalStatus', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('businessApprovalStatus');
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: 'wrong',
    });
    expect(res.status).toBe(401);
  });

  it('accepts loginType=customer for any user', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
      loginType: 'customer',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toContain('customer');
  });

  it('rejects loginType=business for user without business role', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
      loginType: 'business',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/business account/i);
  });

  it('allows loginType=business for user with business role', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE_BIZ,
      password: TEST_PASSWORD,
      loginType: 'business',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toContain('business');
  });

  it('rejects invalid loginType value', async () => {
    const res = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
      loginType: 'admin',
    });
    expect(res.status).toBe(422);
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

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────
describe('POST /api/auth/change-password', () => {
  let pwdToken: string;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/signup').send({
      phone: TEST_PHONE_PWD,
      password: TEST_PASSWORD,
      name: 'Password Test',
    });
    pwdToken = res.body.accessToken;
  });

  it('changes password with correct current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPass@123' });
    expect(res.status).toBe(200);

    // Verify login with new password works
    const login = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE_PWD,
      password: 'NewPass@123',
    });
    expect(login.status).toBe(200);
    pwdToken = login.body.accessToken;
  });

  it('rejects wrong current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ currentPassword: 'WrongPass', newPassword: 'Another@123' });
    expect(res.status).toBe(401);
  });

  it('rejects too-short new password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ currentPassword: 'NewPass@123', newPassword: 'ab' });
    expect(res.status).toBe(422);
  });
});

// ─── LOGOUT ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('requires refreshToken in body', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('logs out successfully', async () => {
    // Get a fresh login for this test
    const login = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
    });
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ refreshToken: login.body.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out');
  });
});

// ─── REFRESH TOKEN ROTATION ─────────────────────────────────────────────────
describe('Refresh token rotation', () => {
  it('old refresh token no longer works after rotation', async () => {
    const login = await request(app).post('/api/auth/login').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);
    const oldRefresh = login.body.refreshToken;
    expect(oldRefresh).toBeDefined();

    // Use the refresh token — should succeed and return new tokens
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).toBeDefined();
    expect(rotated.body.refreshToken).not.toBe(oldRefresh);

    // Old token should now be invalid (hash deleted from DB)
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefresh });
    expect([401, 403]).toContain(reuse.status);
  });
});
