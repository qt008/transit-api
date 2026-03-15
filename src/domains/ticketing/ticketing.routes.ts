import { FastifyInstance } from 'fastify';
import { TicketController, PurchaseTicketSchema, ValidateTicketSchema, ValidateQRSchema } from './controllers/ticket.controller';
import { BookingController, CreateBookingSchema, ProcessPaymentSchema, CancelBookingSchema } from './controllers/booking.controller';
import { checkRouteAccess } from '../../shared/kernel/route-access.middleware';
import { validateBody } from '../../shared/kernel/validate.middleware';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from '../identity/models/user.model';

const ADMINS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];
const CONDUCTORS = [Role.DRIVER, Role.INSPECTOR];
const BOOKING_CREATORS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.PASSENGER];
const BOOKING_VIEWERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.PASSENGER, Role.DRIVER, Role.INSPECTOR];
const BOOKING_CANCELLERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.PASSENGER];
const CHECK_IN_ROLES = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.DRIVER, Role.INSPECTOR, Role.PASSENGER];

export async function ticketingRoutes(fastify: FastifyInstance) {

    // ── Booking Management ────────────────────────────────────────────────────
    fastify.post('/bookings', {
        preHandler: [fastify.authenticate, requireAnyRole(BOOKING_CREATORS), validateBody(CreateBookingSchema)]
    }, BookingController.create);

    fastify.get('/bookings', {
        preHandler: [fastify.authenticate, requireAnyRole(BOOKING_VIEWERS)]
    }, BookingController.list);

    fastify.get('/bookings/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(BOOKING_VIEWERS)]
    }, BookingController.getById);

    fastify.post('/bookings/:id/pay', {
        preHandler: [fastify.authenticate, requireAnyRole(BOOKING_CREATORS), validateBody(ProcessPaymentSchema)]
    }, BookingController.processPayment);

    // Retry payment: intentionally semi-public — handles post-payment provider callback
    fastify.post('/bookings/:id/retry-payment', {
        preHandler: [validateBody(ProcessPaymentSchema)]
    }, BookingController.retryPayment);

    fastify.post('/bookings/:id/cancel', {
        preHandler: [fastify.authenticate, requireAnyRole(BOOKING_CANCELLERS), validateBody(CancelBookingSchema)]
    }, BookingController.cancel);

    fastify.post('/bookings/:id/check-in', {
        preHandler: [fastify.authenticate, requireAnyRole(CHECK_IN_ROLES)]
    }, BookingController.checkIn);

    // ── Operator POS (counter staff walk-in booking) ───────────────────────────
    fastify.post('/pos/bookings', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS), validateBody(CreateBookingSchema)]
    }, BookingController.createPOSBooking);

    // ── Ticket purchase (mobile passenger flow with route ACL check) ───────────
    fastify.post('/purchase', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.PASSENGER]), checkRouteAccess, validateBody(PurchaseTicketSchema)]
    }, TicketController.purchase);

    // ── Self-service ticket view ───────────────────────────────────────────────
    fastify.get('/my-tickets', {
        preHandler: [fastify.authenticate]
    }, TicketController.getMyTickets);

    fastify.get('/:id', {
        preHandler: [fastify.authenticate]
    }, TicketController.getTicketById);

    // ── Ticket validation (conductor device) ──────────────────────────────────
    fastify.post('/:id/validate', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS), validateBody(ValidateTicketSchema)]
    }, TicketController.validateTicket);

    fastify.post('/:id/cancel', {
        preHandler: [fastify.authenticate, requireAnyRole(BOOKING_CANCELLERS)]
    }, TicketController.cancelTicket);

    // Offline validation sync from conductor device
    fastify.post('/sync', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS)]
    }, TicketController.syncValidation);

    // ── Conductor endpoints ────────────────────────────────────────────────────
    fastify.get('/manifest/:tripId', {
        preHandler: [fastify.authenticate, requireAnyRole([...CONDUCTORS, ...ADMINS])]
    }, TicketController.getTripManifest);

    fastify.post('/validate-qr', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS), validateBody(ValidateQRSchema)]
    }, TicketController.validateQR);
}
