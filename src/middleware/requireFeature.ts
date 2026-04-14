import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import prisma from '../utils/prisma';
import { hasFeature, type Feature } from '../utils/tierFeatures';

/**
 * Middleware factory: require the user's active promotion to include a specific tier feature.
 * Returns 403 with upgrade prompt if feature is not available.
 *
 * Usage: router.get('/analytics', authenticate, requireFeature('analytics'), handler)
 */
export function requireFeature(feature: Feature) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    // Find the user's best active promotion (highest tier)
    const promo = await prisma.businessPromotion.findFirst({
      where: {
        user_id: req.user.userId,
        status: 'active',
      },
      orderBy: { visibility_priority_score: 'desc' },
      select: { tier: true },
    });

    const tier = promo?.tier ?? 'free';

    if (!hasFeature(tier, feature)) {
      res.status(403).json({
        error: 'Feature not available on your current plan',
        feature,
        currentTier: tier,
        requiredUpgrade: true,
      });
      return;
    }

    next();
  };
}
