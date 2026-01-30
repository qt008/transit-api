import { FastifyInstance } from 'fastify';
import { AnalyticsController } from './controllers/analytics.controller';

export async function analyticsRoutes(fastify: FastifyInstance) {
    fastify.get('/revenue', AnalyticsController.getRevenue);
    fastify.get('/ridership', AnalyticsController.getRidership);
    fastify.get('/fleet-utilization', AnalyticsController.getFleetUtilization);
    fastify.get('/driver-performance', AnalyticsController.getDriverPerformance);
}
