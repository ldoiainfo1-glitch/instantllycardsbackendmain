import request from 'supertest';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import authRoutes from '../routes/auth';
import businessCardRoutes from '../routes/businessCards';
import prisma from '../utils/prisma';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/cards', businessCardRoutes);

const TEST_PHONE = `+9188${Date.now().toString().slice(-8)}`;
const TEST_PASSWORD = 'Test@1234';
let accessToken: string;
let createdCardId: number;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/signup').send({
    phone: TEST_PHONE,
    password: TEST_PASSWORD,
    name: 'Card Test User',
  });
  accessToken = res.body.accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { phone: TEST_PHONE } });
  await prisma.$disconnect();
});

describe('POST /api/cards', () => {
  it('creates a business card for authenticated user', async () => {
    const res = await request(app)
      .post('/api/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        full_name: 'John Business',
        company_name: 'Test Co',
        category: 'Technology',
        phone: TEST_PHONE,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.company_name).toBe('Test Co');
    createdCardId = res.body.id;
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/cards').send({ full_name: 'Test' });
    expect(res.status).toBe(401);
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('GET /api/cards/my', () => {
  it('returns user cards', async () => {
    const res = await request(app)
      .get('/api/cards/my')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('GET /api/cards/:id', () => {
  it('returns card by id', async () => {
    const res = await request(app).get(`/api/cards/${createdCardId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdCardId);
  });

  it('returns 404 for missing card', async () => {
    const res = await request(app).get('/api/cards/99999999');
    expect(res.status).toBe(404);
  });
});
