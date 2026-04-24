import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import categoryRoutes from './routes/categories';
import businessCardRoutes from './routes/businessCards';
import promotionRoutes from './routes/promotions';
import voucherRoutes from './routes/vouchers';
import adRoutes from './routes/ads';
import reviewRoutes from './routes/reviews';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/uploads';
import bookingRoutes from './routes/bookings';
import leadRoutes from './routes/leads';
import eventRoutes from './routes/events';
import systemRoutes from './routes/system';
import creditRoutes from './routes/credits';
import adminAuthRoutes from './routes/adminAuth';
import feedbackRoutes from './routes/feedback';
import mlmRoutes from './routes/mlm';
import { setIo } from './utils/socket';
import { startScheduledJobs } from './jobs/scheduler';
import chatRoutes from './routes/chats';
import groupRoutes from './routes/groups';
import messageRoutes from './routes/messages';
import notificationRoutes from './routes/notifications';
import { initSocketService } from './services/socketService';

const app = express();
const httpServer = createServer(app);

// Trust the first proxy (Nginx on EC2) so req.ip reflects the real client IP.
// Without this, express-rate-limit sees every request as coming from 127.0.0.1
// and rate-limits ALL users together.
app.set('trust proxy', 1);

// Socket.IO
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
setIo(io);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health check
app.get('/', (_req, res) => res.json({ message: 'Instantlly API running', version: '2.0.0' }));

// ─── Public group invite redirect ────────────────────────────────────────────
// /invite/:code  — served without auth; handles:
//   Android: intent URL → opens app if installed, else Play Store
//   Other:   shows a simple landing page with download link
import prismaInvite from './prismaClient';
app.get('/invite/:code', async (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  const PACKAGE = 'com.instantllycards.www.twa';
  // referrer=ic_join_CODE is read by expo-application on first launch after install
  const PLAY_STORE = `https://play.google.com/store/apps/details?id=${PACKAGE}&referrer=${encodeURIComponent(`ic_join_${code}`)}`;
  const APP_SCHEME = `instantllycards://join?code=${code}`;
  // Android intent URL — opens app if installed, otherwise falls back to Play Store
  const INTENT_URL = `intent://join?code=${code}#Intent;scheme=instantllycards;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)};end`;

  let groupName = 'an Instantlly Cards group';
  let memberCount = 0;
  try {
    const g = await prismaInvite.group.findUnique({
      where: { join_code: code },
      select: { name: true, _count: { select: { members: true } } },
    });
    if (g) {
      groupName = g.name;
      memberCount = g._count.members;
    }
  } catch { /* non-blocking */ }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Join ${groupName} on Instantlly Cards</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F9FAFB;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border-radius:20px;padding:36px 28px;max-width:380px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.09)}
  .icon{width:72px;height:72px;border-radius:36px;background:#EEF2FF;font-size:34px;line-height:72px;margin:0 auto 16px}
  h1{font-size:20px;font-weight:700;color:#111827;margin-bottom:6px}
  .sub{font-size:14px;color:#6B7280;margin-bottom:28px}
  .btn{display:block;width:100%;padding:14px;border-radius:14px;font-size:15px;font-weight:600;text-decoration:none;margin-bottom:12px;cursor:pointer;border:none}
  .btn-primary{background:#6366F1;color:#fff}
  .btn-secondary{background:#F3F4F6;color:#374151}
  .code{font-family:monospace;letter-spacing:4px;font-size:22px;color:#6366F1;font-weight:700;background:#EEF2FF;padding:10px 20px;border-radius:10px;display:inline-block;margin-bottom:24px}
  .footer{margin-top:20px;font-size:12px;color:#9CA3AF}
</style>
</head>
<body>
<div class="card">
  <div class="icon">&#128101;</div>
  <h1>You're invited to join</h1>
  <p class="sub">${groupName}${memberCount > 0 ? ` &middot; ${memberCount} members` : ''}</p>
  <div class="code">${code}</div>
  <a class="btn btn-primary" id="openBtn" href="${APP_SCHEME}">Open in Instantlly Cards</a>
  <a class="btn btn-secondary" href="${PLAY_STORE}">Download App</a>
  <div class="footer">Use join code <strong>${code}</strong> inside the app</div>
</div>
<script>
  // On Android, swap the open button to use the intent:// URL (handles app-not-installed)
  var ua = navigator.userAgent || '';
  if (/android/i.test(ua)) {
    document.getElementById('openBtn').href = '${INTENT_URL}';
  }
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin-auth', adminAuthRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/mlm', mlmRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cards', businessCardRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);

// Socket.IO — real-time chat with auth
initSocketService(io);

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  startScheduledJobs();
});
