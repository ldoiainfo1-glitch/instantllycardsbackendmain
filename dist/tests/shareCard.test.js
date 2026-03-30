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
const businessCards_1 = __importDefault(require("../routes/businessCards"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/auth', auth_1.default);
app.use('/api/cards', businessCards_1.default);
const PHONE_S = `+9155${Date.now().toString().slice(-8)}`;
const PHONE_R = `+9144${Date.now().toString().slice(-8)}`;
let senderToken;
let recipientId;
let cardId;
beforeAll(async () => {
    const [sRes, rRes] = await Promise.all([
        (0, supertest_1.default)(app).post('/api/auth/signup').send({ phone: PHONE_S, password: 'Test@1234', name: 'Sender' }),
        (0, supertest_1.default)(app).post('/api/auth/signup').send({ phone: PHONE_R, password: 'Test@1234', name: 'Recipient' }),
    ]);
    senderToken = sRes.body.accessToken;
    recipientId = rRes.body.user.id;
    const cardRes = await (0, supertest_1.default)(app)
        .post('/api/cards')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ full_name: 'Shareable Card', company_name: 'Share Corp' });
    cardId = cardRes.body.id;
});
afterAll(async () => {
    await prisma_1.default.user.deleteMany({ where: { phone: { in: [PHONE_S, PHONE_R] } } });
    await prisma_1.default.$disconnect();
});
describe('POST /api/cards/share', () => {
    it('shares a card with another user', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/cards/share')
            .set('Authorization', `Bearer ${senderToken}`)
            .send({ card_id: cardId, recipient_user_id: recipientId, message: 'Check this out!' });
        expect(res.status).toBe(201);
        expect(res.body.card_id).toBe(cardId);
    });
    it('requires authentication', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/cards/share')
            .send({ card_id: cardId, recipient_user_id: recipientId });
        expect(res.status).toBe(401);
    });
});
describe('GET /api/cards/shared', () => {
    it('returns shared cards for user', async () => {
        const res = await (0, supertest_1.default)(app)
            .get('/api/cards/shared')
            .set('Authorization', `Bearer ${senderToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});
//# sourceMappingURL=shareCard.test.js.map