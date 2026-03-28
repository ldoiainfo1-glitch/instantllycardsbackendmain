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

const PHONE_S = `+9155${Date.now().toString().slice(-8)}`;
const PHONE_R = `+9144${Date.now().toString().slice(-8)}`;
let senderToken: string;
let recipientId: number;
let cardId: number;

beforeAll(async () => {
  const [sRes, rRes] = await Promise.all([
    request(app).post('/api/auth/signup').send({ phone: PHONE_S, password: 'Test@1234', name: 'Sender' }),
    request(app).post('/api/auth/signup').send({ phone: PHONE_R, password: 'Test@1234', name: 'Recipient' }),
  ]);
  senderToken = sRes.body.accessToken;
  recipientId = rRes.body.user.id;

  const cardRes = await request(app)
    .post('/api/cards')
    .set('Authorization', `Bearer ${senderToken}`)
    .send({ full_name: 'Shareable Card', company_name: 'Share Corp' });
  cardId = cardRes.body.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { phone: { in: [PHONE_S, PHONE_R] } } });
  await prisma.$disconnect();
});

describe('POST /api/cards/share', () => {
  it('shares a card with another user', async () => {
    const res = await request(app)
      .post('/api/cards/share')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ card_id: cardId, recipient_user_id: recipientId, message: 'Check this out!' });
    expect(res.status).toBe(201);
    expect(res.body.card_id).toBe(cardId);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/cards/share')
      .send({ card_id: cardId, recipient_user_id: recipientId });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cards/shared', () => {
  it('returns shared cards for user', async () => {
    const res = await request(app)
      .get('/api/cards/shared')
      .set('Authorization', `Bearer ${senderToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
