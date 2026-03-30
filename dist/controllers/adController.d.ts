import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function listAds(_req: Request, res: Response): Promise<void>;
export declare function trackImpression(req: AuthRequest, res: Response): Promise<void>;
export declare function trackClick(req: AuthRequest, res: Response): Promise<void>;
export declare function getMyAds(req: AuthRequest, res: Response): Promise<void>;
