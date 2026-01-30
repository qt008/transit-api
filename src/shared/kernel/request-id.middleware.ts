import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

declare module 'fastify' {
    interface FastifyRequest {
        id: string;
    }
}

/**
 * Adds unique request ID for distributed tracing
 * Accepts X-Request-ID header or generates new UUID
 */
export const requestIdMiddleware = (
    req: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
) => {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    req.id = requestId;
    reply.header('X-Request-ID', requestId);
    done();
};
