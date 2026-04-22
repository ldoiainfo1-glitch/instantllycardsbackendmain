import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function getCardReviews(req: Request, res: Response): Promise<void>;
export declare function getPromotionReviews(req: Request, res: Response): Promise<void>;
export declare function createReview(req: AuthRequest, res: Response): Promise<void>;
export declare function createFeedback(req: AuthRequest, res: Response): Promise<void>;
