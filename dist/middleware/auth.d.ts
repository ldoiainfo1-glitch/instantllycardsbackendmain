import { Request, RequestHandler } from "express";
import { JwtPayload } from "../utils/jwt";
export interface AuthRequest extends Request {
    userId: any;
    user?: JwtPayload;
    file?: Express.Multer.File;
    files?: Express.Multer.File[] | {
        [fieldname: string]: Express.Multer.File[];
    };
}
export declare const authenticate: RequestHandler;
export declare function requireRole(...roles: string[]): RequestHandler;
