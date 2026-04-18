import { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyAccessToken, JwtPayload } from "../utils/jwt";

export interface AuthRequest extends Request {
  userId: any;
  user?: JwtPayload;
  file?: Express.Multer.File;
  files?:
    | Express.Multer.File[]
    | { [fieldname: string]: Express.Multer.File[] };
}

export const authenticate: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = header.slice(7);
  try {
    (req as AuthRequest).user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Token expired or invalid" });
  }
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }
    const hasRole = roles.some((r) => authReq.user!.roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
