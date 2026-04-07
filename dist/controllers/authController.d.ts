import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare function signup(req: Request, res: Response): Promise<void>;
export declare function login(req: Request, res: Response): Promise<void>;
export declare function refresh(req: Request, res: Response): Promise<void>;
export declare function logout(req: AuthRequest, res: Response): Promise<void>;
export declare function me(req: AuthRequest, res: Response): Promise<void>;
export declare function changePassword(req: AuthRequest, res: Response): Promise<void>;
/**
 * Send OTP for password reset
 */
export declare function sendPasswordResetOTP(req: Request, res: Response): Promise<void>;
/**
 * Verify OTP for password reset
 */
export declare function verifyPasswordResetOTP(req: Request, res: Response): Promise<void>;
/**
 * Reset password after OTP verification
 */
export declare function resetPassword(req: Request, res: Response): Promise<void>;
