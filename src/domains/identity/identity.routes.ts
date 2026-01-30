import { FastifyInstance } from 'fastify';
import { AuthController } from './controllers/auth.controller';

export async function identityRoutes(fastify: FastifyInstance) {
    // Public Routes
    fastify.post('/register', AuthController.register);
    fastify.post('/login', AuthController.login);
    fastify.post('/forgot-password', AuthController.forgotPassword);
    fastify.post('/reset-password', AuthController.resetPassword);

    // Protected Routes
    fastify.get('/me', {
        preHandler: [fastify.authenticate]
    }, AuthController.me);

    fastify.post('/change-password', {
        preHandler: [fastify.authenticate]
    }, AuthController.changePassword);
}
