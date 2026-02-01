import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import { identityRoutes } from './domains/identity/identity.routes';
import { walletRoutes } from './domains/wallet/wallet.routes';
import { ticketingRoutes } from './domains/ticketing/ticketing.routes';
import { fleetRoutes } from './domains/fleet/fleet.routes';
import { healthRoutes } from './shared/kernel/health.routes';
import { driverRoutes } from './domains/identity/driver.routes';
import { analyticsRoutes } from './domains/analytics/analytics.routes';
import { userRoutes } from './domains/identity/user.routes';
import authPlugin from './shared/kernel/auth.plugin';
import { env } from './config/env';
import { connectDatabase } from './database/database.module';
import { errorHandler } from './shared/kernel/error.handler';
import { requestIdMiddleware } from './shared/kernel/request-id.middleware';
import { sanitizationMiddleware, xssProtection } from './shared/kernel/sanitization.middleware';
import { branchRoutes } from './domains/fleet/branch.routes';

const app = fastify({
    logger: {
        level: env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport: env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    disableRequestLogging: false,
    trustProxy: true
});

const start = async () => {
    try {
        // 1. Connect to Database
        await connectDatabase();

        // 2. Security Plugins
        await app.register(helmet, {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", 'data:', 'https:']
                }
            }
        });

        await app.register(cors, {
            origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
        });

        await app.register(rateLimit, {
            max: 100,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
                success: false,
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: 'Too many requests, please try again later'
                }
            })
        });

        await app.register(compress, { encodings: ['gzip', 'deflate'] });

        await app.register(import('@fastify/multipart'), {
            limits: {
                fileSize: 10 * 1024 * 1024 // 10MB limit
            }
        });

        // 3. Global Middleware
        app.addHook('onRequest', requestIdMiddleware);
        app.addHook('preHandler', sanitizationMiddleware);
        app.addHook('preHandler', xssProtection);

        // 4. Auth Plugin (JWT)
        await app.register(authPlugin);

        // 5. Error Handler
        app.setErrorHandler(errorHandler);

        // 6. Health Checks (No auth required)
        await app.register(healthRoutes);

        // 7. BFF Routes Registry

        // Mobile BFF (/api/v1/mobile)
        app.register(async (mobile) => {
            mobile.register(identityRoutes, { prefix: '/auth' });
            mobile.register(userRoutes, { prefix: '/users' });
            mobile.register(walletRoutes, { prefix: '/wallet' });
            mobile.register(ticketingRoutes, { prefix: '/tickets' });
            mobile.register(fleetRoutes, { prefix: '/fleet' });
        }, { prefix: '/api/v1/mobile' });

        // Dashboard BFF (/api/v1/dashboard)
        app.register(async (dash) => {
            dash.register(identityRoutes, { prefix: '/iam' });
            dash.register(driverRoutes, { prefix: '/drivers' });
            dash.register(walletRoutes, { prefix: '/finance' });
            dash.register(fleetRoutes, { prefix: '/ops' });
            dash.register(branchRoutes, { prefix: '/branches' });
            dash.register(analyticsRoutes, { prefix: '/analytics' });
            dash.register(userRoutes, { prefix: '/users' });
            dash.register(ticketingRoutes, { prefix: '/ticketing' });
        }, { prefix: '/api/v1/dashboard' });

        // 8. Graceful Shutdown Handlers
        const signals = ['SIGINT', 'SIGTERM'];
        signals.forEach(signal => {
            process.on(signal, async () => {
                app.log.info(`Received ${signal}, closing server gracefully...`);
                await app.close();
                process.exit(0);
            });
        });

        // 9. Start Server
        const port = parseInt(env.PORT, 10);
        await app.listen({ port, host: '0.0.0.0' });
        app.log.info(`🚀 TransitGhana Enterprise API running on :${port}`);

    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
