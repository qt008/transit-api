import { FastifyInstance } from 'fastify';
import { AnalyticsController } from './controllers/analytics.controller';

export async function analyticsRoutes(fastify: FastifyInstance) {
    fastify.get('/revenue', { preHandler: [fastify.authenticate] }, AnalyticsController.getRevenue);
    fastify.get('/ridership', { preHandler: [fastify.authenticate] }, AnalyticsController.getRidership);
    fastify.get('/fleet-utilization', { preHandler: [fastify.authenticate] }, AnalyticsController.getFleetUtilization);
    fastify.get('/driver-performance', { preHandler: [fastify.authenticate] }, AnalyticsController.getDriverPerformance);
    fastify.get('/recent-activity', { preHandler: [fastify.authenticate] }, AnalyticsController.getRecentActivity);
}
