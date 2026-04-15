import { requireFeature } from '../middleware/requireFeature';
import prisma from '../utils/prisma';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth';

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    businessPromotion: { findFirst: jest.fn() },
  },
}));

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('requireFeature middleware', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 401 if user is not authenticated', async () => {
    const req = {} as AuthRequest;
    const res = mockRes();
    const next = jest.fn();

    await requireFeature('analytics')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for free-tier user accessing analytics', async () => {
    (prisma.businessPromotion.findFirst as jest.Mock).mockResolvedValue(null);

    const req = { user: { userId: 1 } } as AuthRequest;
    const res = mockRes();
    const next = jest.fn();

    await requireFeature('analytics')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'analytics',
        currentTier: 'free',
        requiredUpgrade: true,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for growth-tier user creating ads (boost+ required)', async () => {
    (prisma.businessPromotion.findFirst as jest.Mock).mockResolvedValue({
      tier: 'growth',
    });

    const req = { user: { userId: 2 } } as AuthRequest;
    const res = mockRes();
    const next = jest.fn();

    await requireFeature('ads')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTier: 'growth',
        requiredUpgrade: true,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows growth-tier user to access analytics', async () => {
    (prisma.businessPromotion.findFirst as jest.Mock).mockResolvedValue({
      tier: 'growth',
    });

    const req = { user: { userId: 3 } } as AuthRequest;
    const res = mockRes();
    const next = jest.fn();

    await requireFeature('analytics')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows boost-tier user to create ads', async () => {
    (prisma.businessPromotion.findFirst as jest.Mock).mockResolvedValue({
      tier: 'boost',
    });

    const req = { user: { userId: 4 } } as AuthRequest;
    const res = mockRes();
    const next = jest.fn();

    await requireFeature('ads')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows scale-tier user to access any feature', async () => {
    (prisma.businessPromotion.findFirst as jest.Mock).mockResolvedValue({
      tier: 'scale',
    });

    const req = { user: { userId: 5 } } as AuthRequest;
    const res = mockRes();
    const next = jest.fn();

    for (const feat of ['analytics', 'ads', 'basic_ads', 'max_visibility'] as const) {
      jest.clearAllMocks();
      (prisma.businessPromotion.findFirst as jest.Mock).mockResolvedValue({ tier: 'scale' });
      await requireFeature(feat)(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });

  it('queries only active promotions ordered by score desc', async () => {
    (prisma.businessPromotion.findFirst as jest.Mock).mockResolvedValue({ tier: 'scale' });

    const req = { user: { userId: 6 } } as AuthRequest;
    const res = mockRes();
    const next = jest.fn();

    await requireFeature('analytics')(req, res, next);

    expect(prisma.businessPromotion.findFirst).toHaveBeenCalledWith({
      where: { user_id: 6, status: 'active' },
      orderBy: { visibility_priority_score: 'desc' },
      select: { tier: true },
    });
  });
});
