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
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Health check
app.get('/', (_req, res) => res.json({ message: 'Instantlly API running', version: '2.0.0' }));
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
app.use('/api/chats', chats_1.default);
app.use('/api/groups', groups_1.default);
app.use('/api/messages', messages_1.default);
// Socket.IO — real-time chat with auth
(0, socketService_1.initSocketService)(io);
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map