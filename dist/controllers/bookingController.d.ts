import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function listMyBookings(req: AuthRequest, res: Response): Promise<void>;
export declare function listBusinessBookings(req: AuthRequest, res: Response): Promise<void>;
export declare function listPromotionBookings(req: AuthRequest, res: Response): Promise<void>;
export declare function getBooking(req: AuthRequest, res: Response): Promise<void>;
export declare function createBooking(req: AuthRequest, res: Response): Promise<void>;
export declare function updateBookingStatus(req: AuthRequest, res: Response): Promise<void>;
