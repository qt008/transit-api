import { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
    export interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: { id: string; email?: string; role: string; tenantId: string }; // Updated to match new User schema
        user: { id: string; email?: string; role: string; tenantId: string };
    }
}
