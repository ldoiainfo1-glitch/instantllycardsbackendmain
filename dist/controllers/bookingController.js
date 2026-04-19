"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMyBookings = listMyBookings;
exports.listBusinessBookings = listBusinessBookings;
exports.getBooking = getBooking;
exports.createBooking = createBooking;
exports.updateBookingStatus = updateBookingStatus;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const socketService_1 = require("../services/socketService");
const push_1 = require("../utils/push");
async function listMyBookings(req, res) {
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const bookings = await prisma_1.default.booking.findMany({
        where: { user_id: req.user.userId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { business: { select: { id: true, company_name: true, logo_url: true, full_name: true } } },
    });
    res.json({ data: bookings, page, limit });
}
async function listBusinessBookings(req, res) {
    const businessId = (0, params_1.paramInt)(req.params.businessId);
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = (0, params_1.queryInt)(req.query.limit, 20);
    const status = req.query.status;
    const card = await prisma_1.default.businessCard.findUnique({ where: { id: businessId } });
    if (!card) {
        res.status(404).json({ error: 'Business not found' });
        return;
    }
    if (card.user_id !== req.user.userId && !req.user.roles.includes('admin')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const where = { business_id: businessId };
    if (status)
        where.status = status;
    const bookings = await prisma_1.default.booking.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, name: true, phone: true, profile_picture: true } } },
    });
    res.json({ data: bookings, page, limit });
}
async function getBooking(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const booking = await prisma_1.default.booking.findUnique({
        where: { id },
        include: {
            business: { select: { id: true, company_name: true, logo_url: true, full_name: true, phone: true } },
            user: { select: { id: true, name: true, phone: true, profile_picture: true } },
        },
    });
    if (!booking) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const userId = req.user.userId;
    const isOwner = booking.user_id === userId;
    const isBusinessOwner = booking.business.id === booking.business_id;
    const isAdmin = req.user.roles.includes('admin');
    if (!isOwner && !isBusinessOwner && !isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    res.json(booking);
}
async function createBooking(req, res) {
    const { business_id, business_name, mode, booking_date, booking_time, customer_name, customer_phone, notes, } = req.body;
    const businessId = parseInt(business_id, 10);
    if (!businessId) {
        res.status(400).json({ error: 'business_id is required' });
        return;
    }
    const card = await prisma_1.default.businessCard.findUnique({ where: { id: businessId } });
    if (!card) {
        res.status(404).json({ error: 'Business not found' });
        return;
    }
    const booking = await prisma_1.default.booking.create({
        data: {
            user_id: req.user.userId,
            business_id: businessId,
            business_name: business_name || card.company_name || card.full_name,
            mode: mode || 'visit',
            booking_date: booking_date ? new Date(booking_date) : new Date(),
            booking_time: booking_time || '',
            customer_name: customer_name || '',
            customer_phone: customer_phone || '',
            notes: notes || null,
            status: 'pending',
        },
        include: { business: { select: { id: true, company_name: true, logo_url: true } } },
    });
    // Notify business owner in real-time
    try {
        const businessOwner = await prisma_1.default.user.findUnique({ where: { id: card.user_id }, select: { id: true, push_token: true } });
        if (businessOwner) {
            const io = (0, socketService_1.getIO)();
            const payload = { type: 'booking:created', bookingId: booking.id, businessName: booking.business_name, customerName: customer_name || 'A customer' };
            if (io)
                io.to(`user:${businessOwner.id}`).emit('booking:created', payload);
            if (businessOwner.push_token) {
                (0, push_1.sendExpoPushNotification)(businessOwner.push_token, 'New Booking', `${customer_name || 'A customer'} booked ${booking.business_name}`, { screen: 'Bookings' });
            }
        }
    }
    catch { /* non-blocking */ }
    res.status(201).json(booking);
}
async function updateBookingStatus(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        return;
    }
    const booking = await prisma_1.default.booking.findUnique({
        where: { id },
        include: { business: { select: { user_id: true } } },
    });
    if (!booking) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const userId = req.user.userId;
    const isCustomer = booking.user_id === userId;
    const isBusinessOwner = booking.business.user_id === userId;
    const isAdmin = req.user.roles.includes('admin');
    if (status === 'cancelled' && !isCustomer && !isBusinessOwner && !isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    if ((status === 'confirmed' || status === 'completed') && !isBusinessOwner && !isAdmin) {
        res.status(403).json({ error: 'Only the business owner can confirm/complete bookings' });
        return;
    }
    const updated = await prisma_1.default.booking.update({ where: { id }, data: { status } });
    // Notify the other party about the status change
    try {
        const notifyUserId = isBusinessOwner ? booking.user_id : booking.business.user_id;
        const notifyUser = await prisma_1.default.user.findUnique({ where: { id: notifyUserId }, select: { id: true, push_token: true } });
        if (notifyUser) {
            const io = (0, socketService_1.getIO)();
            const payload = { type: 'booking:updated', bookingId: id, status, businessName: booking.business_name };
            if (io)
                io.to(`user:${notifyUser.id}`).emit('booking:updated', payload);
            if (notifyUser.push_token) {
                (0, push_1.sendExpoPushNotification)(notifyUser.push_token, 'Booking Updated', `Your booking has been ${status}`, { screen: 'Bookings' });
            }
        }
    }
    catch { /* non-blocking */ }
    res.json(updated);
}
//# sourceMappingURL=bookingController.js.map