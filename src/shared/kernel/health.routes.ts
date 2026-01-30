import { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';

interface HealthStatus {
    status: 'healthy' | 'unhealthy';
    timestamp: string;
    uptime: number;
    checks: {
        database: {
            status: 'up' | 'down';
            responseTime?: number;
        };
        memory: {
            usage: number;
            limit: number;
            percentage: number;
        };
    };
}

export async function healthRoutes(fastify: FastifyInstance) {

    /**
     * Liveness probe - Is the app running?
     */
    fastify.get('/health', async (req, reply) => {
        return reply.send({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });

    /**
     * Readiness probe - Can the app serve traffic?
     */
    fastify.get('/ready', async (req, reply) => {
        const startTime = Date.now();

        try {
            // Check MongoDB connection
            const dbStatus = mongoose.connection.readyState === 1 ? 'up' : 'down';
            const dbResponseTime = Date.now() - startTime;

            // Check memory usage
            const memUsage = process.memoryUsage();
            const memLimit = 512 * 1024 * 1024; // 512MB limit (configurable)
            const memPercentage = (memUsage.heapUsed / memLimit) * 100;

            const health: HealthStatus = {
                status: dbStatus === 'up' && memPercentage < 90 ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                checks: {
                    database: {
                        status: dbStatus,
                        responseTime: dbResponseTime
                    },
                    memory: {
                        usage: memUsage.heapUsed,
                        limit: memLimit,
                        percentage: Math.round(memPercentage)
                    }
                }
            };

            const statusCode = health.status === 'healthy' ? 200 : 503;
            return reply.status(statusCode).send(health);

        } catch (error) {
            return reply.status(503).send({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: 'Health check failed'
            });
        }
    });

    /**
     * Metrics endpoint (Prometheus format)
     */
    fastify.get('/metrics', async (req, reply) => {
        const memUsage = process.memoryUsage();

        const metrics = `
# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds gauge
process_uptime_seconds ${process.uptime()}

# HELP process_memory_heap_bytes Process heap memory in bytes
# TYPE process_memory_heap_bytes gauge
process_memory_heap_bytes ${memUsage.heapUsed}

# HELP mongodb_connection_status MongoDB connection status (1=connected, 0=disconnected)
# TYPE mongodb_connection_status gauge
mongodb_connection_status ${mongoose.connection.readyState === 1 ? 1 : 0}
    `.trim();

        return reply
            .header('Content-Type', 'text/plain; version=0.0.4')
            .send(metrics);
    });
}
