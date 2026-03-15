import { FastifyInstance } from 'fastify';
import { AnalyticsController } from './controllers/analytics.controller';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from '../identity/models/user.model';

const ANALYTICS_READERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.GOVERNMENT];
const ANALYTICS_ADMIN = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];

export async function analyticsRoutes(fastify: FastifyInstance) {

    // Broad metrics — SUPER_ADMIN, OPERATOR_ADMIN, GOVERNMENT
    fastify.get('/revenue', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_READERS)]
    }, AnalyticsController.getRevenue);

    fastify.get('/ridership', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_READERS)]
    }, AnalyticsController.getRidership);

    fastify.get('/fleet-utilization', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_READERS)]
    }, AnalyticsController.getFleetUtilization);

    fastify.get('/route-profitability', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_READERS)]
    }, AnalyticsController.getRouteProfitability);

    fastify.get('/geospatial-heatmaps', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_READERS)]
    }, AnalyticsController.getGeospatialHeatmaps);

    fastify.get('/stop-heatmap', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_READERS)]
    }, AnalyticsController.getStopHeatmap);

    // Operational detail — not exposed to GOVERNMENT (individual driver/activity data)
    fastify.get('/driver-performance', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_ADMIN)]
    }, AnalyticsController.getDriverPerformance);

    fastify.get('/recent-activity', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_ADMIN)]
    }, AnalyticsController.getRecentActivity);

    // Report export is a heavy operation — admin only
    fastify.post('/reports/generate', {
        preHandler: [fastify.authenticate, requireAnyRole(ANALYTICS_ADMIN)]
    }, AnalyticsController.generateReport);
}
