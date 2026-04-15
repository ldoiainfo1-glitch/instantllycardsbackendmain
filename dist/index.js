"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const categories_1 = __importDefault(require("./routes/categories"));
const businessCards_1 = __importDefault(require("./routes/businessCards"));
const promotions_1 = __importDefault(require("./routes/promotions"));
const vouchers_1 = __importDefault(require("./routes/vouchers"));
const ads_1 = __importDefault(require("./routes/ads"));
const reviews_1 = __importDefault(require("./routes/reviews"));
const admin_1 = __importDefault(require("./routes/admin"));
const uploads_1 = __importDefault(require("./routes/uploads"));
const bookings_1 = __importDefault(require("./routes/bookings"));
const events_1 = __importDefault(require("./routes/events"));
const system_1 = __importDefault(require("./routes/system"));
const credits_1 = __importDefault(require("./routes/credits"));
const socket_1 = require("./utils/socket");
const scheduler_1 = require("./jobs/scheduler");
const chats_1 = __importDefault(require("./routes/chats"));
const groups_1 = __importDefault(require("./routes/groups"));
const messages_1 = __importDefault(require("./routes/messages"));
const socketService_1 = require("./services/socketService");
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
// Socket.IO
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});
(0, socket_1.setIo)(io);
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Health check
app.get('/', (_req, res) => res.json({ message: 'Instantlly API running', version: '2.0.0' }));
// ─── Public group invite redirect ────────────────────────────────────────────
// /invite/:code  — served without auth; handles:
//   Android: intent URL → opens app if installed, else Play Store
//   Other:   shows a simple landing page with download link
const prismaClient_1 = __importDefault(require("./prismaClient"));
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
        const g = await prismaClient_1.default.group.findUnique({
            where: { join_code: code },
            select: { name: true, _count: { select: { members: true } } },
        });
        if (g) {
            groupName = g.name;
            memberCount = g._count.members;
        }
    }
    catch { /* non-blocking */ }
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
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/categories', categories_1.default);
app.use('/api/cards', businessCards_1.default);
app.use('/api/promotions', promotions_1.default);
app.use('/api/vouchers', vouchers_1.default);
app.use('/api/ads', ads_1.default);
app.use('/api/reviews', reviews_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/uploads', uploads_1.default);
app.use('/api/bookings', bookings_1.default);
app.use('/api/events', events_1.default);
app.use('/api/system', system_1.default);
app.use('/api/credits', credits_1.default);
app.use('/api/chats', chats_1.default);
app.use('/api/groups', groups_1.default);
app.use('/api/messages', messages_1.default);
// Socket.IO — real-time chat with auth
(0, socketService_1.initSocketService)(io);
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    (0, scheduler_1.startScheduledJobs)();
});
//# sourceMappingURL=index.js.map