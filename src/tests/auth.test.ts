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

const TEST_PHONE = `+9199${Date.now().toString().slice(-8)}`;
const NORMALIZED_PHONE = normalizePhone(TEST_PHONE);
const TEST_PASSWORD = 'Test@1234';

let accessToken: string;
let refreshToken: string;

afterAll(async () => {
  // Cleanup test user
  await prisma.user.deleteMany({ where: { phone: TEST_PHONE } });
  await prisma.$disconnect();
});

describe('POST /api/auth/signup', () => {
  it('creates a new user and returns tokens', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
      name: 'Test User',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.roles).toContain('customer');
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
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
