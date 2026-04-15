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
import eventRoutes from './routes/events';
import systemRoutes from './routes/system';
import { startScheduledJobs } from './jobs/scheduler';
import chatRoutes from './routes/chats';
import groupRoutes from './routes/groups';
import messageRoutes from './routes/messages';
import { initSocketService } from './services/socketService';

const app = express();
const httpServer = createServer(app);

// Socket.IO
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health check
app.get('/', (_req, res) => res.json({ message: 'Instantlly API running', version: '2.0.0' }));

// API Routes
app.use('/api/auth', authRoutes);
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
app.use('/api/events', eventRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/messages', messageRoutes);

// Socket.IO — real-time chat with auth
initSocketService(io);

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  startScheduledJobs();
});
