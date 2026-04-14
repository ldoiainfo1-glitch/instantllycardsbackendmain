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
app.use('/api/system', system_1.default);
// Socket.IO
io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);
    socket.on('message', (data) => {
        io.emit('message', data);
    });
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
    });
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);
    });
});
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map