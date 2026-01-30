import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyPlugin from 'fastify-plugin';
import { env } from '../../config/env';

declare module 'fastify' {
    export interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: { id: string; email: string; role: string; walletAccountId: string };
        user: { id: string; email: string; role: string; walletAccountId: string };
    }
}

const authPlugin = async (fastify: FastifyInstance) => {
    fastify.register(fastifyJwt, {
        secret: env.JWT_SECRET,
    });

    fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.send(err);
        }
    });
};

export default fastifyPlugin(authPlugin);
