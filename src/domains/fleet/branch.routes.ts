import { FastifyInstance } from 'fastify';
import { BranchController } from './controllers/branch.controller';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from '../identity/models/user.model';

const BRANCH_MANAGERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];
const BRANCH_READERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.INSPECTOR, Role.GOVERNMENT];

export async function branchRoutes(fastify: FastifyInstance) {

    fastify.post('/', {
        preHandler: [fastify.authenticate, requireAnyRole(BRANCH_MANAGERS)]
    }, BranchController.create);

    fastify.get('/', {
        preHandler: [fastify.authenticate, requireAnyRole(BRANCH_READERS)]
    }, BranchController.getAll);

    fastify.get('/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(BRANCH_READERS)]
    }, BranchController.getById);

    fastify.put('/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(BRANCH_MANAGERS)]
    }, BranchController.update);

    // Deletion is irreversible — SUPER_ADMIN only
    fastify.delete('/:id', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.SUPER_ADMIN])]
    }, BranchController.delete);

    fastify.post('/:id/assign', {
        preHandler: [fastify.authenticate, requireAnyRole(BRANCH_MANAGERS)]
    }, BranchController.assignEntity);

    fastify.delete('/:id/assign/:entityId', {
        preHandler: [fastify.authenticate, requireAnyRole(BRANCH_MANAGERS)]
    }, BranchController.unassignEntity);

    fastify.get('/:id/entities', {
        preHandler: [fastify.authenticate, requireAnyRole(BRANCH_READERS)]
    }, BranchController.getBranchEntities);
}
