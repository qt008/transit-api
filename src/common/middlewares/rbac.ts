import { FastifyRequest, FastifyReply } from 'fastify';
import { IUser, Role } from '../../domains/identity/models/user.model';

export const requireRole = (allowedRoles: Role[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        // req.user is populated by fastify-jwt
        const user = req.user;

        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        // @ts-ignore - Assuming user.role comes from JWT payload
        if (!allowedRoles.includes(user.role as any)) {
            return reply.status(403).send({
                error: 'Forbidden',
                message: `Requires one of access roles: ${allowedRoles.join(', ')}`
            });
        }
    };
};
