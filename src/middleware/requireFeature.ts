import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import prisma from '../utils/prisma';
import { hasFeature, type Feature } from '../utils/tierFeatures';

/**
 * Middleware factory: require a specific tier feature.
 *
 * Supports two modes:
 *   1. Promotion-scoped: if `?promotionId=123` is provided, validates that
 *      the promotion belongs to the user and checks ITS tier.
 *   2. Best-tier fallback: if no promotionId, uses the user's highest active
 *      promotion tier (backward-compatible).
 *
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

    const promotionId = req.query.promotionId
      ? parseInt(req.query.promotionId as string, 10)
      : null;

    console.log(`[requireFeature] START feature=${feature} userId=${req.user.userId} promotionId=${promotionId}`);

    let tier: string;

    if (promotionId) {
      // Promotion-scoped: validate ownership and use this promotion's tier
      const promo = await prisma.businessPromotion.findFirst({
        where: {
          id: promotionId,
          user_id: req.user.userId,
        },
        select: { tier: true, status: true },
      });

      console.log(`[requireFeature] promo-scoped lookup:`, JSON.stringify(promo));

      if (!promo) {
        console.log(`[requireFeature] DENIED: promotion ${promotionId} not found for user ${req.user.userId}`);
        res.status(404).json({ error: 'Promotion not found' });
        return;
      }

      tier = promo.status === 'active' ? (promo.tier ?? 'free') : 'free';
    } else {
      // Fallback: user's best active promotion (backward-compatible)
      const promo = await prisma.businessPromotion.findFirst({
        where: {
          user_id: req.user.userId,
          status: 'active',
        },
        orderBy: { visibility_priority_score: 'desc' },
        select: { tier: true },
      });

      console.log(`[requireFeature] fallback lookup (best tier):`, JSON.stringify(promo));

      tier = promo?.tier ?? 'free';
    }

    const allowed = hasFeature(tier, feature);
    console.log(`[requireFeature] DECISION feature=${feature} tier=${tier} allowed=${allowed} userId=${req.user.userId} promotionId=${promotionId}`);

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
