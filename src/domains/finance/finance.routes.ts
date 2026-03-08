import { FastifyInstance } from 'fastify';
import { SettlementController, CalculateSchema, ExecuteSchema } from './controllers/settlement.controller';
import { validateBody } from '../../shared/kernel/validate.middleware';

export async function financeRoutes(fastify: FastifyInstance) {

    // Collection summary (stakeholder dashboard)
    fastify.get('/collection-summary', { preHandler: [fastify.authenticate] }, SettlementController.collectionSummary);
    fastify.get('/bus-revenue', { preHandler: [fastify.authenticate] }, SettlementController.busRevenue);

    // Settlement management
    fastify.get('/settlements', { preHandler: [fastify.authenticate] }, SettlementController.list);
    fastify.get('/settlements/:id', { preHandler: [fastify.authenticate] }, SettlementController.getById);
    fastify.post('/settlements/calculate', {
        preHandler: [fastify.authenticate, validateBody(CalculateSchema)]
    }, SettlementController.calculate);
    fastify.post('/settlements/:id/approve', { preHandler: [fastify.authenticate] }, SettlementController.approve);
    fastify.post('/settlements/:id/execute', {
        preHandler: [fastify.authenticate, validateBody(ExecuteSchema)]
    }, SettlementController.execute);
}
