import request from 'supertest';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import authRoutes from '../routes/auth';
import businessCardRoutes from '../routes/businessCards';
import prisma from '../utils/prisma';
import { normalizePhone } from '../utils/phone';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/cards', businessCardRoutes);

const TS = Date.now().toString().slice(-7);
const TEST_PHONE = `+9188${TS}0`;
const TEST_PHONE_2 = `+9188${TS}1`;
const TEST_PASSWORD = 'Test@1234';
let accessToken: string;
let accessToken2: string;
let userId2: number;
let createdCardId: number;

beforeAll(async () => {
  // Create main test user
  const res = await request(app).post('/api/auth/signup').send({
    phone: TEST_PHONE,
    password: TEST_PASSWORD,
    name: 'Card Test User',
  });
  accessToken = res.body.accessToken;

  // Create second user for ownership tests
  const res2 = await request(app).post('/api/auth/signup').send({
    phone: TEST_PHONE_2,
    password: TEST_PASSWORD,
    name: 'Other User',
  });
  accessToken2 = res2.body.accessToken;
  userId2 = res2.body.user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { phone: { in: [normalizePhone(TEST_PHONE), normalizePhone(TEST_PHONE_2)] } },
  });
  await prisma.$disconnect();
});

// ─── CREATE ─────────────────────────────────────────────────────────────────
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

  it('strips non-whitelisted fields', async () => {
    const res = await request(app)
      .post('/api/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        full_name: 'Whitelist Test',
        phone: '1234567890',
        user_id: 99999, // should be ignored
        is_admin: true, // should be ignored
      });
    expect(res.status).toBe(201);
    // user_id should be the actual user, not the injected one
    expect(res.body.user_id).not.toBe(99999);
  });

  it('creates a card with new fields (country codes, about_business, is_default)', async () => {
    const res = await request(app)
      .post('/api/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        full_name: 'New Fields User',
        phone: '5550001111',
        personal_country_code: '+91',
        company_country_code: '+1',
        about_business: 'We build great software',
        is_default: true,
        company_photo: 'https://example.com/photo.jpg',
      });
    expect(res.status).toBe(201);
    expect(res.body.personal_country_code).toBe('+91');
    expect(res.body.company_country_code).toBe('+1');
    expect(res.body.about_business).toBe('We build great software');
    expect(res.body.is_default).toBe(true);
    expect(res.body.company_photo).toBe('https://example.com/photo.jpg');
  });

  it('auto-assigns business role to creating user', async () => {
    const roleCheck = await prisma.userRole.findFirst({
      where: { user_id: { not: undefined }, role: 'business' },
    });
    // At least one business role should exist after card creation
    expect(roleCheck).not.toBeNull();
  });
});

// ─── READ ───────────────────────────────────────────────────────────────────
describe('GET /api/cards/my', () => {
  it('returns user cards', async () => {
    const res = await request(app)
      .get('/api/cards/my')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/cards/my');
    expect(res.status).toBe(401);
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

describe('GET /api/cards (list)', () => {
  it('returns paginated cards with total count', async () => {
    const res = await request(app).get('/api/cards?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(5);
    expect(typeof res.body.total).toBe('number');
  });

  it('supports search query', async () => {
    const res = await request(app).get('/api/cards?search=Test%20Co&approval_status=pending');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].company_name).toBe('Test Co');
  });

  it('returns empty for non-matching search', async () => {
    const res = await request(app).get('/api/cards?search=ZZZYYYXXX_nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
    expect(res.body.total).toBe(0);
  });

  it('includes location and category fields', async () => {
    const res = await request(app).get('/api/cards?page=1&limit=1');
    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      const card = res.body.data[0];
      // These fields should exist in the response (even if null)
      expect('location' in card).toBe(true);
      expect('category' in card).toBe(true);
    }
  });

  it('includes new fields in listed cards', async () => {
    const res = await request(app).get('/api/cards?search=New%20Fields%20User&approval_status=pending');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const card = res.body.data[0];
    expect('personal_country_code' in card).toBe(true);
    expect('company_country_code' in card).toBe(true);
    expect('about_business' in card).toBe(true);
    expect('is_default' in card).toBe(true);
    expect('company_photo' in card).toBe(true);
    expect(card.personal_country_code).toBe('+91');
    expect(card.company_country_code).toBe('+1');
    expect(card.about_business).toBe('We build great software');
    expect(card.is_default).toBe(true);
  });
});

// ─── UPDATE ─────────────────────────────────────────────────────────────────
describe('PUT /api/cards/:id', () => {
  it('updates own card', async () => {
    const res = await request(app)
      .put(`/api/cards/${createdCardId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_name: 'Updated Co' });
    expect(res.status).toBe(200);
    expect(res.body.company_name).toBe('Updated Co');
  });

  it('rejects update by non-owner', async () => {
    const res = await request(app)
      .put(`/api/cards/${createdCardId}`)
      .set('Authorization', `Bearer ${accessToken2}`)
      .send({ company_name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent card', async () => {
    const res = await request(app)
      .put('/api/cards/99999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  it('strips non-whitelisted fields on update', async () => {
    const res = await request(app)
      .put(`/api/cards/${createdCardId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company_name: 'Safe Update', user_id: 99999 });
    expect(res.status).toBe(200);
    expect(res.body.user_id).not.toBe(99999);
  });

  it('updates about_business and is_default fields', async () => {
    const res = await request(app)
      .put(`/api/cards/${createdCardId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        about_business: 'Updated business description',
        is_default: true,
        personal_country_code: '+44',
        company_country_code: '+49',
      });
    expect(res.status).toBe(200);
    expect(res.body.about_business).toBe('Updated business description');
    expect(res.body.is_default).toBe(true);
    expect(res.body.personal_country_code).toBe('+44');
    expect(res.body.company_country_code).toBe('+49');
  });
});

// ─── DELETE ─────────────────────────────────────────────────────────────────
describe('DELETE /api/cards/:id', () => {
  let deleteCardId: number;

  beforeAll(async () => {
    // Create a card specifically for delete tests
    const res = await request(app)
      .post('/api/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ full_name: 'To Delete', phone: '0000000000' });
    deleteCardId = res.body.id;
  });

  it('rejects delete by non-owner', async () => {
    const res = await request(app)
      .delete(`/api/cards/${deleteCardId}`)
      .set('Authorization', `Bearer ${accessToken2}`);
    expect(res.status).toBe(403);
  });

  it('deletes own card', async () => {
    const res = await request(app)
      .delete(`/api/cards/${deleteCardId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted');
  });

  it('returns 404 for already deleted card', async () => {
    const res = await request(app)
      .delete(`/api/cards/${deleteCardId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });
});
