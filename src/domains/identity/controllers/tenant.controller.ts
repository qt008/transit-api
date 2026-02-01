import { FastifyRequest, FastifyReply } from 'fastify';
import { TenantService } from '../services/tenant.service';
import { Role } from '../models/user.model';

export class TenantController {
    /**
     * Get current user's tenant
     * GET /identity/tenant
     */
    static async getCurrentTenant(req: FastifyRequest, reply: FastifyReply) {
        try {
            // @ts-ignore
            const tenantId = req.user?.tenantId;

            if (!tenantId) {
                return reply.status(400).send({ message: 'Tenant ID not found' });
            }

            const tenant = await TenantService.getTenantById(tenantId);

            if (!tenant) {
                return reply.status(404).send({ message: 'Tenant not found' });
            }

            return reply.send(tenant);
        } catch (error: any) {
            return reply.status(500).send({ message: error.message });
        }
    }

    /**
     * Update current user's tenant
     * PUT /identity/tenant
     * Restricted to OPERATOR_ADMIN and GOVERNMENT roles
     */
    static async updateCurrentTenant(req: FastifyRequest, reply: FastifyReply) {
        try {
            // @ts-ignore
            const tenantId = req.user?.tenantId;
            // @ts-ignore
            const userRole = req.user?.role as Role;

            if (!tenantId) {
                return reply.status(400).send({ message: 'Tenant ID not found' });
            }

            // Restrict to admin roles
            if (![Role.OPERATOR_ADMIN, Role.GOVERNMENT, Role.SUPER_ADMIN].includes(userRole)) {
                return reply.status(403).send({ message: 'Insufficient permissions' });
            }

            const body = req.body as any;
            const { name, logo, contactEmail, contactPhone, address, config } = body;

            const updates: any = {};
            if (name !== undefined) updates.name = name;
            if (logo !== undefined) updates.logo = logo;
            if (contactEmail !== undefined) updates.contactEmail = contactEmail;
            if (contactPhone !== undefined) updates.contactPhone = contactPhone;
            if (address !== undefined) updates.address = address;
            if (config !== undefined) updates.config = config;

            const updatedTenant = await TenantService.updateTenant(tenantId, updates);

            if (!updatedTenant) {
                return reply.status(404).send({ message: 'Tenant not found' });
            }

            return reply.send(updatedTenant);
        } catch (error: any) {
            return reply.status(500).send({ message: error.message });
        }
    }
}
