import { FastifyInstance } from 'fastify';
import { UserController } from './controllers/user.controller';

export async function userRoutes(fastify: FastifyInstance) {
    fastify.get('/me/profile', UserController.getProfile);
    fastify.patch('/me/profile', UserController.updateProfile);
    fastify.post('/me/photo', UserController.uploadPhoto);
    fastify.patch('/me/preferences', UserController.updatePreferences);
    fastify.delete('/me', UserController.deleteAccount);
}
