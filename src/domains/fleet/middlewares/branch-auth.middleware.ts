import { FastifyRequest, FastifyReply } from 'fastify';
import { Role } from '../../identity/models/user.model';

export const requireBranchAccess = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as any;
    const { id } = req.params as any; // Branch ID to check access for

    // 1. Super Admin has access to everything
    if (user.roles.includes(Role.SUPER_ADMIN)) {
        return;
    }

    // 2. Check if user is assigned to this branch
    // Assuming user.branchIds is populated on login/auth
    if (user.branchIds && user.branchIds.includes(id)) {
        return;
    }

    // 3. Deny access
    return reply.code(403).send({ error: 'Access denied: You are not authorized to view this branch.' });
};
