import { FastifyRequest, FastifyReply } from 'fastify';
import { BranchService } from '../services/branch.service';
import { IBranch } from '../models/branch.model';
import { AssignmentEntityType } from '../models/branch-assignment.model';
import { z } from 'zod';

// Validation Schemas
const createBranchSchema = z.object({
    name: z.string().min(3),
    code: z.string().min(2),
    type: z.enum(['TERMINAL', 'STOP']).default('TERMINAL'),
    address: z.string(),
    city: z.string(),
    region: z.string(),
    coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
    phone: z.string().optional(),
    email: z.string().email().or(z.literal('')).optional(),
    managerId: z.string().optional(),
    managerName: z.string().optional(), // Can be auto-populated
    operatingHours: z.object({
        open: z.string(),
        close: z.string()
    }).optional(),
    parkingCapacity: z.number().optional()
});

const updateBranchSchema = createBranchSchema.partial();

const assignEntitySchema = z.object({
    entityType: z.enum(['DRIVER', 'VEHICLE', 'USER']),
    entityId: z.string(),
    isPrimary: z.boolean().default(false)
});

export class BranchController {
    // Branch CRUD
    static async create(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId, userId } = req.user as any;
            const data = createBranchSchema.parse(req.body);

            // If managerId provided, validate existence and get name
            if (data.managerId) {
                const manager = await BranchService.validateManager(data.managerId, tenantId);
                if (!manager) {
                    return reply.code(400).send({ error: 'Invalid manager ID or user not found in tenant' });
                }
                data.managerName = `${manager.firstName} ${manager.lastName}`;
            }

            const branch = await BranchService.createBranch(data as any, tenantId);

            return reply.code(201).send(branch);
        } catch (error) {
            console.log('Create branch error:', error);
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ error: 'Validation error', details: error.errors });
            }
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }

    static async getAll(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId, branchIds, roles } = req.user as any;
            const { search, status, type } = req.query as any;

            // Scope based on user roles
            // Super admins see all, others see only assigned branches?
            // For now, let's fetch all providing they belong to tenant

            // Note: Data scoping for normal users should be handled here if strict
            // If strictly branch-scoped user, maybe filter results? 
            // For now, listing all branches in tenant is usually fine for directory

            const branches = await BranchService.getBranches(tenantId, { search, status, type });
            return reply.send(branches);
        } catch (error) {
            console.error('Get branches error:', error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }

    static async getById(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId } = req.user as any;
            const { id } = req.params as any;

            const branch = await BranchService.getBranchById(id, tenantId);
            if (!branch) {
                return reply.code(404).send({ error: 'Branch not found' });
            }

            return reply.send(branch);
        } catch (error) {
            console.error('Get branch details error:', error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }

    static async update(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId } = req.user as any;
            const { id } = req.params as any;
            const data = updateBranchSchema.parse(req.body);

            // If managerId is being updated
            if (data.managerId) {
                const manager = await BranchService.validateManager(data.managerId, tenantId);
                if (!manager) {
                    return reply.code(400).send({ error: 'Invalid manager ID or user not found in tenant' });
                }
                data.managerName = `${manager.firstName} ${manager.lastName}`;
            }

            const branch = await BranchService.updateBranch(id, data as any, tenantId);
            if (!branch) {
                return reply.code(404).send({ error: 'Branch not found' });
            }

            return reply.send(branch);
        } catch (error) {
            console.error('Update branch error:', error);
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ error: 'Validation error', details: error.errors });
            }
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }

    static async delete(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId } = req.user as any;
            const { id } = req.params as any;

            const success = await BranchService.deleteBranch(id, tenantId);
            if (!success) {
                return reply.code(404).send({ error: 'Branch not found' });
            }

            return reply.code(204).send();
        } catch (error) {
            console.error('Delete branch error:', error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }

    // Assignments
    static async assignEntity(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId, userId } = req.user as any;
            const { id } = req.params as any; // Branch ID
            const { entityType, entityId, isPrimary } = assignEntitySchema.parse(req.body);

            // Verify branch exists
            const branch = await BranchService.getBranchById(id, tenantId);
            if (!branch) return reply.code(404).send({ error: 'Branch not found' });

            const assignment = await BranchService.assignEntity(
                id,
                entityType as AssignmentEntityType,
                entityId,
                tenantId,
                userId,
                isPrimary
            );

            return reply.code(201).send(assignment);
        } catch (error) {
            console.error('Assign entity error:', error);
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ error: 'Validation error', details: error.errors });
            }
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }

    static async unassignEntity(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId } = req.user as any;
            const { id, entityId } = req.params as any;
            const { entityType } = req.query as any; // Pass type in query for delete? Or body?
            // Better to use query or specific body for delete if complex key

            if (!entityType) return reply.code(400).send({ error: 'Entity type required' });

            const success = await BranchService.unassignEntity(
                id,
                entityType as AssignmentEntityType,
                entityId,
                tenantId
            );

            if (!success) return reply.code(404).send({ error: 'Assignment not found' });

            return reply.code(204).send();
        } catch (error) {
            console.error('Unassign entity error:', error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }

    static async getBranchEntities(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { tenantId } = req.user as any;
            const { id } = req.params as any;
            const { type } = req.query as any;

            if (!type) return reply.code(400).send({ error: 'Entity type required' });

            const entities = await BranchService.getBranchEntities(
                id,
                type as AssignmentEntityType,
                tenantId
            );

            return reply.send(entities);
        } catch (error) {
            console.error('Get branch entities error:', error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    }
}
