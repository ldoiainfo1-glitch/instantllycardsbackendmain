import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function listPromotions(req: Request, res: Response): Promise<void>;
export declare function getPromotion(req: Request, res: Response): Promise<void>;
export declare function createPromotion(req: AuthRequest, res: Response): Promise<void>;
export declare function updatePromotion(req: AuthRequest, res: Response): Promise<void>;
export declare function getMyPromotions(req: AuthRequest, res: Response): Promise<void>;
/**
 * GET /promotions/pricing-plans
 * Returns all active pricing plans for premium listings.
 */
export declare function listPricingPlans(_req: Request, res: Response): Promise<void>;
/**
 * POST /promotions/:id/payment-intent
 * Creates a Razorpay order for a promotion's premium plan.
 * Body: { pricing_plan_id: number }
 */
export declare function createPromotionPaymentIntent(req: AuthRequest, res: Response): Promise<void>;
/**
 * POST /promotions/:id/verify-payment
 * Verifies Razorpay payment and activates the promotion plan.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
export declare function verifyPromotionPayment(req: AuthRequest, res: Response): Promise<void>;
/**
 * POST /promotions/:id/retry-payment
 * Allows retry for promotions stuck in pending_payment status.
 * Body: { pricing_plan_id: number }
 */
export declare function retryPromotionPayment(req: AuthRequest, res: Response): Promise<void>;
export declare function listPromotionsNearby(req: Request, res: Response): Promise<void>;
