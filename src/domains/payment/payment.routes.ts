import { FastifyInstance } from 'fastify';
import { PaymentController } from './controllers/payment.controller';

export async function paymentRoutes(fastify: FastifyInstance) {
    fastify.post('/webhook', PaymentController.handleWebhook);
    fastify.post('/mock-callback', PaymentController.handleMockCallback);
}
