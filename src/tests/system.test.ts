import request from 'supertest';
import express from 'express';
import systemRoutes from '../routes/system';

const app = express();
app.use(express.json());
app.use('/api/system', systemRoutes);

describe('GET /api/system/version', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env vars before each test
    process.env = { ...originalEnv };
    delete process.env.APP_CURRENT_VERSION;
    delete process.env.APP_MIN_VERSION;
    delete process.env.APP_RECOMMENDED_VERSION;
    delete process.env.APP_FORCE_UPDATE;
    delete process.env.APP_UPDATE_URL;
    delete process.env.APP_UPDATE_MESSAGE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns default values when no env vars are set', async () => {
    const res = await request(app).get('/api/system/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currentVersion: '1.0.80',
      minVersion: '1.0.0',
      recommendedVersion: '1.0.80',
      forceUpdate: false,
      updateUrl: 'https://play.google.com/store/apps/details?id=com.instantllycards.www.twa',
      message: '',
    });
  });

  it('returns custom values from env vars', async () => {
    process.env.APP_CURRENT_VERSION = '2.0.0';
    process.env.APP_MIN_VERSION = '1.5.0';
    process.env.APP_RECOMMENDED_VERSION = '1.8.0';
    process.env.APP_FORCE_UPDATE = 'true';
    process.env.APP_UPDATE_URL = 'https://custom-store.com/app';
    process.env.APP_UPDATE_MESSAGE = 'Critical security patch';

    const res = await request(app).get('/api/system/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currentVersion: '2.0.0',
      minVersion: '1.5.0',
      recommendedVersion: '1.8.0',
      forceUpdate: true,
      updateUrl: 'https://custom-store.com/app',
      message: 'Critical security patch',
    });
  });

  it('forceUpdate is false when env is not "true"', async () => {
    process.env.APP_FORCE_UPDATE = 'false';
    const res = await request(app).get('/api/system/version');
    expect(res.body.forceUpdate).toBe(false);

    process.env.APP_FORCE_UPDATE = 'yes';
    const res2 = await request(app).get('/api/system/version');
    expect(res2.body.forceUpdate).toBe(false);
  });

  it('recommendedVersion defaults to currentVersion', async () => {
    process.env.APP_CURRENT_VERSION = '3.0.0';
    const res = await request(app).get('/api/system/version');
    expect(res.body.recommendedVersion).toBe('3.0.0');
  });

  it('responds with correct content-type', async () => {
    const res = await request(app).get('/api/system/version');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
