import { FastifyInstance } from 'fastify';
import { TicketController, PurchaseTicketSchema, ValidateTicketSchema, ValidateQRSchema } from './controllers/ticket.controller';
import { BookingController, CreateBookingSchema, ProcessPaymentSchema, CancelBookingSchema } from './controllers/booking.controller';
import { checkRouteAccess } from '../../shared/kernel/route-access.middleware';
import { validateBody } from '../../shared/kernel/validate.middleware';

export async function ticketingRoutes(fastify: FastifyInstance) {

    // Booking Management
    fastify.post('/bookings', {
        preHandler: [fastify.authenticate, validateBody(CreateBookingSchema)]
    }, BookingController.create);
    fastify.get('/bookings', { preHandler: [fastify.authenticate] }, BookingController.list);
    fastify.get('/bookings/:id', { preHandler: [fastify.authenticate] }, BookingController.getById);
    fastify.post('/bookings/:id/pay', {
        preHandler: [fastify.authenticate, validateBody(ProcessPaymentSchema)]
    }, BookingController.processPayment);
    fastify.post('/bookings/:id/retry-payment', {
        preHandler: [validateBody(ProcessPaymentSchema)]
    }, BookingController.retryPayment);
    fastify.post('/bookings/:id/cancel', {
        preHandler: [fastify.authenticate, validateBody(CancelBookingSchema)]
    }, BookingController.cancel);
    fastify.post('/bookings/:id/check-in', { preHandler: [fastify.authenticate] }, BookingController.checkIn);

    // Operator POS
    fastify.post('/pos/bookings', {
        preHandler: [fastify.authenticate, validateBody(CreateBookingSchema)]
    }, BookingController.createPOSBooking);

    // Purchase requires auth AND route access check
    fastify.post('/purchase', {
        preHandler: [fastify.authenticate, checkRouteAccess, validateBody(PurchaseTicketSchema)]
    }, TicketController.purchase);

    // My tickets
    fastify.get('/my-tickets', TicketController.getMyTickets);
    fastify.get('/:id', TicketController.getTicketById);

    // Validation (driver)
    fastify.post('/:id/validate', {
        preHandler: [validateBody(ValidateTicketSchema)]
    }, TicketController.validateTicket);

    // Cancellation
    fastify.post('/:id/cancel', TicketController.cancelTicket);

    // Legacy sync
    fastify.post('/sync', TicketController.syncValidation);

    // Conductor device endpoints
    fastify.get('/manifest/:tripId', { preHandler: [fastify.authenticate] }, TicketController.getTripManifest);
    fastify.post('/validate-qr', {
        preHandler: [fastify.authenticate, validateBody(ValidateQRSchema)]
    }, TicketController.validateQR);
}
