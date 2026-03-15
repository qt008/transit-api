import { FastifyInstance } from 'fastify';
import { AuthController } from './controllers/auth.controller';
import { TenantController } from './controllers/tenant.controller';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from './models/user.model';

const TENANT_ADMINS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];

export async function identityRoutes(fastify: FastifyInstance) {

    // ── Public (no auth required) ────────────────────────────────────────────
    fastify.post('/register', AuthController.register);
    fastify.post('/login', AuthController.login);
    fastify.post('/verify-otp', AuthController.verifyOTP);
    fastify.post('/resend-otp', AuthController.resendOTP);
    fastify.post('/forgot-password', AuthController.forgotPassword);
    fastify.post('/reset-password', AuthController.resetPassword);
    fastify.post('/refresh', AuthController.refresh);

    // ── Any authenticated user ───────────────────────────────────────────────
    fastify.get('/me', { preHandler: [fastify.authenticate] }, AuthController.me);

    fastify.post('/change-password', {
        preHandler: [fastify.authenticate]
    }, AuthController.changePassword);

    // ── Tenant management — SUPER_ADMIN, OPERATOR_ADMIN only ─────────────────
    fastify.get('/tenant', {
        preHandler: [fastify.authenticate, requireAnyRole(TENANT_ADMINS)]
    }, TenantController.getCurrentTenant);

    fastify.put('/tenant', {
        preHandler: [fastify.authenticate, requireAnyRole(TENANT_ADMINS)]
    }, TenantController.updateCurrentTenant);
}
