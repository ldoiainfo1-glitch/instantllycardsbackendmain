"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
const categories_1 = __importDefault(require("../routes/categories"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/categories', categories_1.default);
const suffix = Date.now().toString().slice(-6);
const ROOT_NAME = `Root ${suffix}`;
const CHILD_NAME = `Child ${suffix}`;
const LEGACY_ROOT_NAME = `LegacyRoot ${suffix}`;
let rootId;
let legacyRootId;
beforeAll(async () => {
    const root = await prisma_1.default.category.create({
        data: {
            name: ROOT_NAME,
            icon: '??',
            sort_order: 1,
            is_active: true,
        },
    });
    rootId = root.id;
    await prisma_1.default.category.create({
        data: {
            name: CHILD_NAME,
            parent_id: root.id,
            level: 1,
            is_active: true,
            sort_order: 1,
        },
    });
    const legacy = await prisma_1.default.category.create({
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
    await prisma_1.default.category.deleteMany({
        where: {
            name: { in: [ROOT_NAME, CHILD_NAME, LEGACY_ROOT_NAME] },
        },
    });
    await prisma_1.default.$disconnect();
});
describe('GET /api/categories/mobile', () => {
    it('returns root categories with child counts', async () => {
        const res = await (0, supertest_1.default)(app).get('/api/categories/mobile');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        const root = res.body.data.find((c) => c.id === rootId);
        expect(root).toBeTruthy();
        expect(root.child_count).toBeGreaterThanOrEqual(1);
    });
});
describe('GET /api/categories/mobile/:id/subcategories', () => {
    it('returns child node names for category with children', async () => {
        const res = await (0, supertest_1.default)(app).get(`/api/categories/mobile/${rootId}/subcategories`);
        expect(res.status).toBe(200);
        expect(res.body.data.categoryId).toBe(rootId);
        expect(res.body.data.subcategories).toContain(CHILD_NAME);
    });
    it('falls back to legacy subcategories when no child nodes exist', async () => {
        const res = await (0, supertest_1.default)(app).get(`/api/categories/mobile/${legacyRootId}/subcategories`);
        expect(res.status).toBe(200);
        expect(res.body.data.categoryId).toBe(legacyRootId);
        expect(res.body.data.subcategories.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=category.test.js.map