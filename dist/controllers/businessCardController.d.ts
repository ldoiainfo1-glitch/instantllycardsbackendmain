import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function listCards(req: Request, res: Response): Promise<void>;
export declare function getCard(req: Request, res: Response): Promise<void>;
export declare function createCard(req: AuthRequest, res: Response): Promise<void>;
export declare function updateCard(req: AuthRequest, res: Response): Promise<void>;
export declare function deleteCard(req: AuthRequest, res: Response): Promise<void>;
export declare function getMyCards(req: AuthRequest, res: Response): Promise<void>;
export declare function shareCard(req: AuthRequest, res: Response): Promise<void>;
export declare function getSharedCards(req: AuthRequest, res: Response): Promise<void>;
/**
 * POST /api/cards/bulk-send
 * Sends a business card to every user who has an approved, live card
 * in the specified category (or subcategory). Skips the sender themselves
 * and skips any duplicate (same card → same recipient) within the last 30 days.
 */
export declare function bulkSendCard(req: AuthRequest, res: Response): Promise<void>;
