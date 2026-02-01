import { FastifyInstance } from 'fastify';
import { BranchController } from './controllers/branch.controller';

export async function branchRoutes(fastify: FastifyInstance) {
    // Core Branch Management
    fastify.post('/', { preHandler: [fastify.authenticate] }, BranchController.create);
    fastify.get('/', { preHandler: [fastify.authenticate] }, BranchController.getAll);
    fastify.get('/:id', { preHandler: [fastify.authenticate] }, BranchController.getById);
    fastify.put('/:id', { preHandler: [fastify.authenticate] }, BranchController.update);
    fastify.delete('/:id', { preHandler: [fastify.authenticate] }, BranchController.delete);

    // Entity Assignments
    fastify.post('/:id/assign', { preHandler: [fastify.authenticate] }, BranchController.assignEntity);
    fastify.delete('/:id/assign/:entityId', { preHandler: [fastify.authenticate] }, BranchController.unassignEntity);
    fastify.get('/:id/entities', { preHandler: [fastify.authenticate] }, BranchController.getBranchEntities);
}
