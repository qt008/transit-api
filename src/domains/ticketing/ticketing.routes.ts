import { FastifyInstance } from 'fastify';
import { TicketController } from './controllers/ticket.controller';
import { BookingController } from './controllers/booking.controller';
import { checkRouteAccess } from '../../shared/kernel/route-access.middleware';

export async function ticketingRoutes(fastify: FastifyInstance) {

    // Booking Management
    fastify.post('/bookings', { preHandler: [fastify.authenticate] }, BookingController.create);
    fastify.get('/bookings', { preHandler: [fastify.authenticate] }, BookingController.list);
    fastify.get('/bookings/:id', { preHandler: [fastify.authenticate] }, BookingController.getById);
    fastify.post('/bookings/:id/pay', { preHandler: [fastify.authenticate] }, BookingController.processPayment);
    fastify.post('/bookings/:id/cancel', { preHandler: [fastify.authenticate] }, BookingController.cancel);
    fastify.post('/bookings/:id/check-in', { preHandler: [fastify.authenticate] }, BookingController.checkIn);

    // Operator POS
    fastify.post('/pos/bookings', { preHandler: [fastify.authenticate] }, BookingController.createPOSBooking);

    // Purchase requires auth AND route access check
    fastify.post('/purchase', {
        preHandler: [fastify.authenticate, checkRouteAccess]
    }, TicketController.purchase);

    // My tickets
    fastify.get('/my-tickets', TicketController.getMyTickets);
    fastify.get('/:id', TicketController.getTicketById);

    // Validation (driver)
    fastify.post('/:id/validate', TicketController.validateTicket);

    // Cancellation
    fastify.post('/:id/cancel', TicketController.cancelTicket);

    // Legacy sync
    fastify.post('/sync', TicketController.syncValidation);
}
