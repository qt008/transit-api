import { FastifyInstance } from 'fastify';
import { DriverController } from './controllers/driver.controller';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from './models/user.model';

const DRIVER_MANAGERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];
const DRIVER_READERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.INSPECTOR, Role.GOVERNMENT];

export async function driverRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('onRequest', fastify.authenticate);

    fastify.post('/', {
        preHandler: [requireAnyRole(DRIVER_MANAGERS)]
    }, DriverController.create);

    fastify.get('/', {
        preHandler: [requireAnyRole(DRIVER_READERS)]
    }, DriverController.list);

    fastify.get('/:id', {
        preHandler: [requireAnyRole(DRIVER_READERS)]
    }, DriverController.getById);

    fastify.patch('/:id', {
        preHandler: [requireAnyRole(DRIVER_MANAGERS)]
    }, DriverController.update);

    fastify.post('/:id/assign-vehicle', {
        preHandler: [requireAnyRole(DRIVER_MANAGERS)]
    }, DriverController.assignVehicle);

    fastify.post('/:id/deactivate', {
        preHandler: [requireAnyRole(DRIVER_MANAGERS)]
    }, DriverController.deactivate);
}
