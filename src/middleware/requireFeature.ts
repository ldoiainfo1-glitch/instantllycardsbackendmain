import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthRequest } from './auth';
import prisma from '../utils/prisma';
import { hasFeature, type Feature } from '../utils/tierFeatures';

/**
 * Middleware factory: require a specific tier feature.
 */
export function requireFeature(feature: Feature): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const promotionId = req.query.promotionId
      ? parseInt(req.query.promotionId as string, 10)
      : null;

    let tier: string;

    if (promotionId) {
      const promo = await prisma.businessPromotion.findFirst({
        where: {
          id: promotionId,
          user_id: authReq.user!.userId,
        },
        select: { tier: true, status: true },
      });

      if (!promo) {
        res.status(404).json({ error: 'Promotion not found' });
        return;
      }

      tier = promo.status === 'active' ? (promo.tier ?? 'free') : 'free';
    } else {
      const promo = await prisma.businessPromotion.findFirst({
        where: {
          user_id: authReq.user!.userId,
          status: 'active',
        },
        orderBy: { visibility_priority_score: 'desc' },
        select: { tier: true },
      });

      tier = promo?.tier ?? 'free';
    }

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
