import { FastifyInstance } from 'fastify';
import { UserController } from './controllers/user.controller';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from './models/user.model';

export async function userRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('onRequest', fastify.authenticate);

    // Personal profile routes (available to all authenticated users)
    fastify.get('/me/profile', UserController.getProfile);
    fastify.patch('/me/profile', UserController.updateProfile);
    fastify.post('/me/photo', UserController.uploadPhoto);
    fastify.patch('/me/preferences', UserController.updatePreferences);
    fastify.delete('/me', UserController.deleteAccount);

    // Admin user management routes
    fastify.post('/', {
        preHandler: [requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN])]
    }, UserController.createUser);

    fastify.get('/', {
        preHandler: [requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN])]
    }, UserController.listUsers);

    fastify.get('/:userId', {
        preHandler: [requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN])]
    }, UserController.getUserById);

    fastify.patch('/:userId', {
        preHandler: [requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN])]
    }, UserController.updateUser);

    fastify.post('/:userId/deactivate', {
        preHandler: [requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN])]
    }, UserController.deactivateUser);

    fastify.post('/:userId/reactivate', {
        preHandler: [requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN])]
    }, UserController.reactivateUser);

    fastify.post('/:userId/reset-password', {
        preHandler: [requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN])]
    }, UserController.resetUserPassword);
}
