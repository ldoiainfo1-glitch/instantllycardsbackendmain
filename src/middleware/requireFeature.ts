import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthRequest } from './auth';
import prisma from '../utils/prisma';
import { hasFeature, type Feature } from '../utils/tierFeatures';

type PromotionIdSource = 'query' | 'body' | 'params';

interface RequireFeatureOptions {
  requirePromotionId?: boolean;
  promotionIdField?: string;
  promotionIdSource?: PromotionIdSource;
}

function readPromotionId(req: Request, options?: RequireFeatureOptions): number | null {
  const source = options?.promotionIdSource ?? 'query';
  const field = options?.promotionIdField ?? 'promotionId';
  const container = source === 'query' ? req.query : source === 'params' ? req.params : (req as any).body;
  const raw = container?.[field];
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = parseInt(String(raw), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Middleware factory: require a specific tier feature.
 */
export function requireFeature(feature: Feature, options?: RequireFeatureOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const promotionId = readPromotionId(req, options);
    const resolvedPromotionId = promotionId;

    if (options?.requirePromotionId && !resolvedPromotionId) {
      res.status(400).json({ error: 'promotionId is required for this feature check' });
      return;
    }

    console.log(`[requireFeature] START feature=${feature} userId=${authReq.user.userId} promotionId=${promotionId}`);

    let tier: string;

    if (resolvedPromotionId) {
      const promo = await prisma.businessPromotion.findFirst({
        where: {
          id: resolvedPromotionId,
          user_id: authReq.user!.userId,
        },
        select: { tier: true, status: true },
      });

      if (!promo) {
        console.log(`[requireFeature] DENIED: promotion ${promotionId} not found for user ${authReq.user.userId}`);
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

    const allowed = hasFeature(tier, feature);
    console.log(`[requireFeature] DECISION feature=${feature} tier=${tier} allowed=${allowed} userId=${authReq.user.userId} promotionId=${promotionId}`);

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
