import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

// Socket.IO setup with CORS
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Configure for your frontend URL in production
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());

// Basic health check route
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  // Handle custom events
  socket.on('message', (data) => {
    console.log('📩 Message received:', data);
    // Broadcast to all connected clients
    io.emit('message', data);
  });

  // Handle room joining
  socket.on('join-room', (roomId: string) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
