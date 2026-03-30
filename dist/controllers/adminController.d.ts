import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function getDashboardCounts(_req: AuthRequest, res: Response): Promise<void>;
export declare function getPendingPromotions(req: AuthRequest, res: Response): Promise<void>;
export declare function approvePromotion(req: AuthRequest, res: Response): Promise<void>;
export declare function rejectPromotion(req: AuthRequest, res: Response): Promise<void>;
export declare function listUsers(req: AuthRequest, res: Response): Promise<void>;
