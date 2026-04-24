import { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyAccessToken, JwtPayload } from "../utils/jwt";

/**
 * requireAdminKey — accepts x-admin-key header OR Bearer JWT with admin role.
 * Used by Instantlly-admin Next.js panel (sends x-admin-key on every request).
 */
export const requireAdminKey: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const adminKey = process.env.ADMIN_KEY || '';

  // 1. x-admin-key header (used by admin panel)
  if (adminKey && req.headers['x-admin-key'] === adminKey) {
    next();
    return;
  }

  // 2. Bearer JWT with admin role
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      if (payload.roles?.includes('admin')) {
        (req as AuthRequest).user = payload;
        next();
        return;
      }
    } catch {}
  }

  res.status(401).json({ error: 'Admin access required. Provide x-admin-key header or admin JWT.' });
};

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
