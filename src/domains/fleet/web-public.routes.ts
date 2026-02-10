import { FastifyInstance } from 'fastify';
import { WebPublicController } from './controllers/web-public.controller';

export async function webPublicRoutes(fastify: FastifyInstance) {
    // Routes
    fastify.get('/routes', WebPublicController.listRoutes);
    fastify.get('/routes/popular', WebPublicController.popularRoutes);
    fastify.get('/routes/:id', WebPublicController.getRoute);

    // Trip Search & Availability
    fastify.get('/trips', WebPublicController.searchTrips);
    fastify.get('/trips/:id/availability', WebPublicController.getTripAvailability);

    // Fare Calculation
    fastify.post('/fare/calculate', WebPublicController.calculateFare);

    // Guest Booking (no auth)
    fastify.post('/bookings', WebPublicController.createBooking);
    fastify.get('/bookings/:id', WebPublicController.getBooking);

    // Payment
    fastify.post('/bookings/:id/pay', WebPublicController.initiatePayment);
    fastify.post('/bookings/:id/retry-payment', WebPublicController.retryPayment);
}
