import request from 'supertest';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import categoryRoutes from '../routes/categories';
import prisma from '../utils/prisma';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/categories', categoryRoutes);

const suffix = Date.now().toString().slice(-6);
const ROOT_NAME = `Root ${suffix}`;
const CHILD_NAME = `Child ${suffix}`;
const LEGACY_ROOT_NAME = `LegacyRoot ${suffix}`;

let rootId: number;
let legacyRootId: number;

beforeAll(async () => {
  const root = await prisma.category.create({
    data: {
      name: ROOT_NAME,
      icon: '??',
      sort_order: 1,
      is_active: true,
    },
  });
  rootId = root.id;

  await prisma.category.create({
    data: {
      name: CHILD_NAME,
      parent_id: root.id,
      level: 1,
      is_active: true,
      sort_order: 1,
    },
  });

  const legacy = await prisma.category.create({
    data: {
      name: LEGACY_ROOT_NAME,
      icon: '??',
      sort_order: 2,
      is_active: true,
      subcategories: ['Legacy One', 'Legacy Two', 'Legacy Three'],
    },
  });
  legacyRootId = legacy.id;
});

afterAll(async () => {
  await prisma.category.deleteMany({
    where: {
      name: { in: [ROOT_NAME, CHILD_NAME, LEGACY_ROOT_NAME] },
    },
  });
  await prisma.$disconnect();
});

describe('GET /api/categories/mobile', () => {
  it('returns root categories with child counts', async () => {
    const res = await request(app).get('/api/categories/mobile');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const root = res.body.data.find((c: any) => c.id === rootId);
    expect(root).toBeTruthy();
    expect(root.child_count).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/categories/mobile/:id/subcategories', () => {
  it('returns child node names for category with children', async () => {
    const res = await request(app).get(`/api/categories/mobile/${rootId}/subcategories`);
    expect(res.status).toBe(200);
    expect(res.body.data.categoryId).toBe(rootId);
    expect(res.body.data.subcategories).toContain(CHILD_NAME);
  });

  it('falls back to legacy subcategories when no child nodes exist', async () => {
    const res = await request(app).get(`/api/categories/mobile/${legacyRootId}/subcategories`);
    expect(res.status).toBe(200);
    expect(res.body.data.categoryId).toBe(legacyRootId);
    expect(res.body.data.subcategories.length).toBeGreaterThan(0);
  });
});
