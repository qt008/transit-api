import { FastifyInstance } from 'fastify';
import { AuthController } from './controllers/auth.controller';
import { TenantController } from './controllers/tenant.controller';

export async function identityRoutes(fastify: FastifyInstance) {
    // Public Routes
    fastify.post('/register', AuthController.register);
    fastify.post('/login', AuthController.login);
    fastify.post('/verify-otp', AuthController.verifyOTP);
    fastify.post('/resend-otp', AuthController.resendOTP);
    fastify.post('/forgot-password', AuthController.forgotPassword);
    fastify.post('/reset-password', AuthController.resetPassword);
    fastify.post('/refresh', AuthController.refresh);

    // Protected Routes
    fastify.get('/me', {
        preHandler: [fastify.authenticate]
    }, AuthController.me);

    fastify.post('/change-password', {
        preHandler: [fastify.authenticate]
    }, AuthController.changePassword);

    // Tenant Routes (Protected)
    fastify.get('/tenant', {
        preHandler: [fastify.authenticate]
    }, TenantController.getCurrentTenant);

    fastify.put('/tenant', {
        preHandler: [fastify.authenticate]
    }, TenantController.updateCurrentTenant);
}
