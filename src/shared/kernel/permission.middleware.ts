import { FastifyRequest, FastifyReply } from 'fastify';
import { Role } from '../../domains/identity/models/user.model';
import { Permission, hasPermission, getRolePermissions } from '../constants/permissions';

/**
 * Middleware to check if user has a specific permission
 */
export const requirePermission = (permission: Permission) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        const user = req.user as any;

        if (!user) {
            return reply.code(401).send({ error: 'Authentication required' });
        }

        const userRole = user.roles?.[0] as Role;
        if (!userRole) {
            return reply.code(403).send({ error: 'User role not found' });
        }

        const userPermissions = getRolePermissions(userRole);

        if (!hasPermission(userPermissions, permission)) {
            return reply.code(403).send({
                error: 'Insufficient permissions',
                required: permission
            });
        }
    };
};

/**
 * Middleware to check if user has any of the specified roles
 */
export const requireAnyRole = (roles: Role[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        const user = req.user as any;

        if (!user) {
            return reply.code(401).send({ error: 'Authentication required' });
        }

        const userRoles = user.roles || [];
        const hasRequiredRole = roles.some(role => userRoles.includes(role));

        if (!hasRequiredRole) {
            return reply.code(403).send({
                error: 'Insufficient role',
                required: roles,
                current: userRoles
            });
        }
    };
};

/**
 * Middleware to check if user has all of the specified roles
 */
export const requireAllRoles = (roles: Role[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        const user = req.user as any;

        if (!user) {
            return reply.code(401).send({ error: 'Authentication required' });
        }

        const userRoles = user.roles || [];
        const hasAllRoles = roles.every(role => userRoles.includes(role));

        if (!hasAllRoles) {
            return reply.code(403).send({
                error: 'Missing required roles',
                required: roles,
                current: userRoles
            });
        }
    };
};

/**
 * Middleware to check if user is authenticated and attach permissions
 */
export const attachPermissions = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as any;

    if (!user) {
        return reply.code(401).send({ error: 'Authentication required' });
    }

    const userRole = user.roles?.[0] as Role;
    if (userRole) {
        // Attach permissions to user object for easy access
        user.permissions = getRolePermissions(userRole);
    }
};
