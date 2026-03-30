"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
const auth_1 = __importDefault(require("../routes/auth"));
const vouchers_1 = __importDefault(require("../routes/vouchers"));
const businessCards_1 = __importDefault(require("../routes/businessCards"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/auth', auth_1.default);
app.use('/api/vouchers', vouchers_1.default);
app.use('/api/cards', businessCards_1.default);
const PHONE_A = `+9177${Date.now().toString().slice(-8)}`;
const PHONE_B = `+9166${Date.now().toString().slice(-8)}`;
let tokenA;
let tokenB;
let voucherId;
let cardId;
beforeAll(async () => {
    const [rA, rB] = await Promise.all([
        (0, supertest_1.default)(app).post('/api/auth/signup').send({ phone: PHONE_A, password: 'Test@1234' }),
        (0, supertest_1.default)(app).post('/api/auth/signup').send({ phone: PHONE_B, password: 'Test@1234' }),
    ]);
    tokenA = rA.body.accessToken;
    tokenB = rB.body.accessToken;
    // Create a card for userA to attach voucher
    const cardRes = await (0, supertest_1.default)(app)
        .post('/api/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ full_name: 'Voucher Business', company_name: 'Voucher Co' });
    cardId = cardRes.body.id;
    // Seed a voucher directly
    const v = await prisma_1.default.voucher.create({
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
    await prisma_1.default.user.deleteMany({ where: { phone: { in: [PHONE_A, PHONE_B] } } });
    await prisma_1.default.$disconnect();
});
describe('GET /api/vouchers', () => {
    it('lists active vouchers', async () => {
        const res = await (0, supertest_1.default)(app).get('/api/vouchers');
        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
    });
});
describe('POST /api/vouchers/:id/claim', () => {
    it('allows authenticated user to claim a voucher', async () => {
        const res = await (0, supertest_1.default)(app)
            .post(`/api/vouchers/${voucherId}/claim`)
            .set('Authorization', `Bearer ${tokenA}`);
        expect(res.status).toBe(201);
    });
    it('prevents double claiming', async () => {
        const res = await (0, supertest_1.default)(app)
            .post(`/api/vouchers/${voucherId}/claim`)
            .set('Authorization', `Bearer ${tokenA}`);
        expect(res.status).toBe(409);
    });
    it('requires authentication', async () => {
        const res = await (0, supertest_1.default)(app).post(`/api/vouchers/${voucherId}/claim`);
        expect(res.status).toBe(401);
    });
});
describe('POST /api/vouchers/transfer', () => {
    it('allows transfer to another user', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/vouchers/transfer')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ voucher_id: voucherId, recipient_phone: PHONE_B });
        expect(res.status).toBe(201);
    });
});
describe('GET /api/vouchers/my', () => {
    it('returns claimed vouchers for user', async () => {
        const res = await (0, supertest_1.default)(app)
            .get('/api/vouchers/my')
            .set('Authorization', `Bearer ${tokenA}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});
//# sourceMappingURL=voucher.test.js.map