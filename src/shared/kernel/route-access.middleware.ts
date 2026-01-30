import { FastifyRequest, FastifyReply } from 'fastify';
import { RouteModel } from '../../domains/fleet/models/route.model';
import { UserModel } from '../../domains/identity/models/user.model';

/**
 * Middleware to check if user has access to purchase tickets for a route
 */
export const checkRouteAccess = async (
    req: FastifyRequest,
    reply: FastifyReply
) => {
    try {
        // @ts-ignore
        const userId = req.user?.id;
        if (!userId) {
            return reply.status(401).send({ error: 'Authentication required' });
        }

        // Get routeId from body or params
        const routeId = (req.body as any)?.routeId || (req.params as any)?.routeId;
        if (!routeId) {
            return reply.status(400).send({ error: 'Route ID required' });
        }

        // Fetch route and user
        const [route, user] = await Promise.all([
            RouteModel.findOne({ routeId }),
            UserModel.findOne({ userId })
        ]);

        if (!route) {
            return reply.status(404).send({ error: 'Route not found' });
        }

        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        const { accessControl } = route;

        // Check tenant restrictions
        if (accessControl.restrictedTenants?.includes(user.tenantId)) {
            return reply.status(403).send({
                error: 'Your organization is not allowed to purchase tickets for this route'
            });
        }

        // Check role permissions
        const userRole = user.roles[0]; // Primary role
        if (accessControl.allowedRoles && accessControl.allowedRoles.length > 0) {
            if (!accessControl.allowedRoles.includes(userRole)) {
                return reply.status(403).send({
                    error: 'Your role is not authorized for this route'
                });
            }
        }

        // Check operator whitelist (for bulk/merchant purchases)
        if (accessControl.allowedOperators && accessControl.allowedOperators.length > 0) {
            if (!accessControl.allowedOperators.includes(user.tenantId)) {
                return reply.status(403).send({
                    error: 'Your organization is not whitelisted for this route'
                });
            }
        }

        // Access granted
        // @ts-ignore
        req.route = route;
    } catch (err: any) {
        return reply.status(500).send({ error: 'Access control check failed' });
    }
};
