import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function listPromotions(req: Request, res: Response): Promise<void>;
export declare function getPromotion(req: Request, res: Response): Promise<void>;
export declare function createPromotion(req: AuthRequest, res: Response): Promise<void>;
export declare function updatePromotion(req: AuthRequest, res: Response): Promise<void>;
export declare function getMyPromotions(req: AuthRequest, res: Response): Promise<void>;
export declare function listPromotionsNearby(req: Request, res: Response): Promise<void>;
