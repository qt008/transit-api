import { FastifyRequest, FastifyReply } from 'fastify';
import { VehicleModel, VehicleStatus } from '../models/vehicle.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const CreateVehicleSchema = z.object({
    operatorId: z.string(),
    plateNumber: z.string(),
    capacity: z.number(),
    type: z.string()
});

const UpdateVehicleSchema = z.object({
    capacity: z.number().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'IN_MAINTENANCE', 'ON_TRIP']).optional()
});

const AssignRoutesSchema = z.object({
    routeIds: z.array(z.string())
});

export class VehicleController {

    /**
     * POST /vehicles - Create vehicle
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateVehicleSchema.parse(req.body);

        try {
            const existing = await VehicleModel.findOne({ plateNumber: body.plateNumber });
            if (existing) throw new Error('Vehicle with this plate number already exists');

            const vehicle = await VehicleModel.create({
                vehicleId: `VEH-${randomUUID()}`,
                ...body,
                assignedRoutes: [],
                currentRouteIndex: 0
            });

            return reply.status(201).send({ success: true, data: vehicle });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /vehicles?operatorId=X - List vehicles
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        const { operatorId, status } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = {};
        if (operatorId) filter.operatorId = operatorId;
        if (status) filter.status = status;

        const [vehicles, total] = await Promise.all([
            VehicleModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(params.skip)
                .limit(params.limit),
            VehicleModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(vehicles, total, params));
    }

    /**
     * GET /vehicles/:id - Get vehicle
     */
    static async getById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        const vehicle = await VehicleModel.findOne({ vehicleId: id });
        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });

        return reply.send({ success: true, data: vehicle });
    }

    /**
     * PATCH /vehicles/:id - Update vehicle
     */
    static async update(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const updates = UpdateVehicleSchema.parse(req.body);

        const vehicle = await VehicleModel.findOneAndUpdate(
            { vehicleId: id },
            { $set: updates },
            { new: true }
        );

        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });

        return reply.send({ success: true, data: vehicle });
    }

    /**
     * POST /vehicles/:id/assign-routes - Assign multiple routes to vehicle
     */
    static async assignRoutes(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { routeIds } = AssignRoutesSchema.parse(req.body);

        const vehicle = await VehicleModel.findOneAndUpdate(
            { vehicleId: id },
            {
                assignedRoutes: routeIds,
                currentRouteIndex: 0
            },
            { new: true }
        );

        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });

        return reply.send({
            success: true,
            message: `Assigned ${routeIds.length} routes to vehicle`,
            data: vehicle
        });
    }

    /**
     * POST /vehicles/:id/transition-route - Move to next route in sequence
     */
    static async transitionRoute(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        try {
            const vehicle = await VehicleModel.findOne({ vehicleId: id });
            if (!vehicle) throw new Error('Vehicle not found');

            if (vehicle.assignedRoutes.length === 0) {
                throw new Error('No routes assigned to this vehicle');
            }

            // Move to next route (circular)
            const nextIndex = (vehicle.currentRouteIndex + 1) % vehicle.assignedRoutes.length;
            vehicle.currentRouteIndex = nextIndex;
            await vehicle.save();

            return reply.send({
                success: true,
                message: `Transitioned to route ${vehicle.assignedRoutes[nextIndex]}`,
                data: {
                    currentRouteId: vehicle.assignedRoutes[nextIndex],
                    currentRouteIndex: nextIndex
                }
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }
}
