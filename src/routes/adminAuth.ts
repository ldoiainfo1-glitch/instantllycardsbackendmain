import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'instantlly-jwt-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'instantlly-admin-2024';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// POST /api/admin-auth/login
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) { res.status(400).json({ success: false, message: 'Username and password are required' }); return; }
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) { res.status(401).json({ success: false, message: 'Invalid credentials' }); return; }
  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, message: 'Login successful', data: { token, admin: { id: 'admin-1', username, email: process.env.ADMIN_EMAIL || 'admin@instantlly.com', role: 'admin' } } });
});

// GET /api/admin-auth/verify
router.get('/verify', (req: Request, res: Response) => {
  if (req.headers['x-admin-key'] === ADMIN_KEY && ADMIN_KEY) { res.json({ success: true, valid: true, admin: { username: ADMIN_USERNAME, role: 'admin' } }); return; }
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (!token) { res.status(401).json({ success: false, message: 'No token provided' }); return; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    res.json({ success: true, valid: true, admin: { username: decoded.username, role: decoded.role } });
  } catch { res.status(401).json({ success: false, message: 'Invalid or expired token' }); }
});

export default router;
