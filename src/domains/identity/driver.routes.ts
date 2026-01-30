import { FastifyInstance } from 'fastify';
import { DriverController } from './controllers/driver.controller';

export async function driverRoutes(fastify: FastifyInstance) {
    // All routes require authentication (registered in server.ts)

    fastify.post('/', DriverController.create);
    fastify.get('/', DriverController.list);
    fastify.get('/:id', DriverController.getById);
    fastify.patch('/:id', DriverController.update);
    fastify.post('/:id/assign-vehicle', DriverController.assignVehicle);
    fastify.post('/:id/deactivate', DriverController.deactivate);
}
