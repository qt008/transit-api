import { FastifyInstance } from 'fastify';
import { TicketController } from './controllers/ticket.controller';
import { checkRouteAccess } from '../../shared/kernel/route-access.middleware';

export async function ticketingRoutes(fastify: FastifyInstance) {

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
