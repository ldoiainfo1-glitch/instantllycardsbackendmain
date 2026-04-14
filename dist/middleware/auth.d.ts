import { Request, Response, NextFunction } from "express";
import { JwtPayload } from "../utils/jwt";
export interface AuthRequest extends Request {
    user?: JwtPayload;
    file?: Express.Multer.File;
    files?: Express.Multer.File[] | {
        [fieldname: string]: Express.Multer.File[];
    };
}
export declare function authenticate(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireRole(...roles: string[]): (req: AuthRequest, res: Response, next: NextFunction) => void;
