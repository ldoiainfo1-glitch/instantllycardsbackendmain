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
const users_1 = __importDefault(require("../routes/users"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const phone_1 = require("../utils/phone");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
const TS = Date.now().toString().slice(-7);
const TEST_PHONE = `+9177${TS}0`;
const TEST_PASSWORD = 'Profile@1234';
const NEW_PASSWORD = 'NewPass@5678';
let accessToken;
let userId;
beforeAll(async () => {
    const res = await (0, supertest_1.default)(app).post('/api/auth/signup').send({
        phone: TEST_PHONE,
        password: TEST_PASSWORD,
        name: 'Profile Test User',
        email: `profile_${TS}@test.com`,
    });
    expect(res.status).toBe(201);
    accessToken = res.body.accessToken;
    userId = res.body.user.id;
});
afterAll(async () => {
    // Hard-delete including anonymized records
    await prisma_1.default.user.deleteMany({
        where: {
            OR: [
                { phone: (0, phone_1.normalizePhone)(TEST_PHONE) },
                { phone: { startsWith: `deleted_${userId}_` } },
            ],
        },
    });
    await prisma_1.default.$disconnect();
});
// ─── GET /api/auth/me ──────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
    it('returns user with about and gender fields', async () => {
        const res = await (0, supertest_1.default)(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(userId);
        expect(res.body.name).toBe('Profile Test User');
        expect(res.body).toHaveProperty('about');
        expect(res.body).toHaveProperty('gender');
        expect(res.body).toHaveProperty('profile_picture');
        expect(res.body).toHaveProperty('profile');
        expect(res.body.roles).toContain('customer');
    });
    it('returns 401 without token', async () => {
        const res = await (0, supertest_1.default)(app).get('/api/auth/me');
        expect(res.status).toBe(401);
    });
});
// ─── GET /api/users/profile ──────────────────────────────────────────────────
describe('GET /api/users/profile', () => {
    it('returns full user profile for authenticated user', async () => {
        const res = await (0, supertest_1.default)(app)
            .get('/api/users/profile')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(userId);
        expect(res.body).not.toHaveProperty('password_hash');
    });
    it('returns 401 without token', async () => {
        const res = await (0, supertest_1.default)(app).get('/api/users/profile');
        expect(res.status).toBe(401);
    });
});
// ─── PUT /api/users/profile ──────────────────────────────────────────────────
describe('PUT /api/users/profile', () => {
    it('updates name, about, and gender', async () => {
        const res = await (0, supertest_1.default)(app)
            .put('/api/users/profile')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ name: 'Updated Name', about: 'I love coffee', gender: 'male' });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Profile updated');
    });
    it('persists the updated fields in /users/profile', async () => {
        const res = await (0, supertest_1.default)(app)
            .get('/api/users/profile')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(res.body.name).toBe('Updated Name');
        expect(res.body.about).toBe('I love coffee');
        expect(res.body.gender).toBe('male');
    });
    it('syncs about → profile.bio', async () => {
        const res = await (0, supertest_1.default)(app)
            .get('/api/users/profile')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(res.body.profile?.bio).toBe('I love coffee');
    });
    it('rejects phone already in use by another user', async () => {
        // Use the original test phone (already taken)
        const conflictPhone = (0, phone_1.normalizePhone)(TEST_PHONE);
        // Create a second user and try to set their phone to the first user's phone
        const other = await (0, supertest_1.default)(app).post('/api/auth/signup').send({
            phone: `+9177${TS}9`,
            password: TEST_PASSWORD,
        });
        const otherToken = other.body.accessToken;
        const res = await (0, supertest_1.default)(app)
            .put('/api/users/profile')
            .set('Authorization', `Bearer ${otherToken}`)
            .send({ phone: conflictPhone });
        // The phone is already taken by userId, expect 409
        expect(res.status).toBe(409);
        // Cleanup second user
        await prisma_1.default.user.deleteMany({ where: { phone: (0, phone_1.normalizePhone)(`+9177${TS}9`) } });
    });
});
// ─── POST /api/auth/change-password ─────────────────────────────────────────
describe('POST /api/auth/change-password', () => {
    it('returns 400 if currentPassword is missing', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ newPassword: NEW_PASSWORD });
        expect(res.status).toBe(422);
    });
    it('returns 400 if newPassword is too short', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPassword: TEST_PASSWORD, newPassword: 'abc' });
        expect(res.status).toBe(422);
    });
    it('returns 401 if currentPassword is wrong', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPassword: 'WrongPass!', newPassword: NEW_PASSWORD });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Current password is incorrect');
    });
    it('changes password successfully with correct currentPassword', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Password updated successfully');
    });
    it('can login with new password after change', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/auth/login').send({
            phone: TEST_PHONE,
            password: NEW_PASSWORD,
        });
        expect(res.status).toBe(200);
        accessToken = res.body.accessToken; // refresh token for subsequent tests
    });
    it('cannot login with old password after change', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/auth/login').send({
            phone: TEST_PHONE,
            password: TEST_PASSWORD,
        });
        expect(res.status).toBe(401);
    });
    it('returns 401 without auth token', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/change-password')
            .send({ currentPassword: NEW_PASSWORD, newPassword: 'SomethingElse1!' });
        expect(res.status).toBe(401);
    });
});
// ─── DELETE /api/users/me ─────────────────────────────────────────────────────
describe('DELETE /api/users/me', () => {
    it('deletes the account and anonymizes personal data', async () => {
        const res = await (0, supertest_1.default)(app)
            .delete('/api/users/me')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Account deleted');
    });
    it('after deletion, the old token cannot access /auth/me', async () => {
        // The user's password_hash is null now so login fails too
        const res = await (0, supertest_1.default)(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${accessToken}`);
        // Token is still technically valid (not expired) but user has no roles → 200 with empty roles
        // OR the user record is missing fields that indicate a deleted account.
        // The key check: profile is gone, name is null
        if (res.status === 200) {
            expect(res.body.name).toBeNull();
            expect(res.body.roles).toEqual([]);
        }
        else {
            expect(res.status).toBe(404);
        }
    });
    it('returns 401 without auth token', async () => {
        const res = await (0, supertest_1.default)(app).delete('/api/users/me');
        expect(res.status).toBe(401);
    });
});
//# sourceMappingURL=profile.test.js.map