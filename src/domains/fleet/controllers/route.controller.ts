import { FastifyRequest, FastifyReply } from 'fastify';
import { RouteModel, RouteStop } from '../models/route.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const CreateRouteSchema = z.object({
    name: z.string(),
    operatorId: z.string(),
    geometry: z.object({
        coordinates: z.array(z.array(z.number()))
    }),
    basePrice: z.number(),
    estimatedDuration: z.number()
});

const AddStopSchema = z.object({
    name: z.string(),
    location: z.object({
        coordinates: z.tuple([z.number(), z.number()])
    }),
    sequence: z.number(),
    estimatedArrivalMinutes: z.number()
});

const SetAccessControlSchema = z.object({
    allowedRoles: z.array(z.string()).optional(),
    allowedOperators: z.array(z.string()).optional(),
    restrictedTenants: z.array(z.string()).optional()
});

export class RouteController {

    /**
     * POST /routes - Create route
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateRouteSchema.parse(req.body);

        try {
            const route = await RouteModel.create({
                routeId: `ROUTE-${randomUUID()}`,
                ...body,
                geometry: {
                    type: 'LineString',
                    coordinates: body.geometry.coordinates
                },
                stops: [],
                accessControl: {
                    allowedRoles: ['PASSENGER'], // Default: passengers only
                    allowedOperators: [],
                    restrictedTenants: []
                }
            });

            return reply.status(201).send({ success: true, data: route });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /routes - List routes
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        const { operatorId, isActive } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = {};
        if (operatorId) filter.operatorId = operatorId;
        if (isActive !== undefined) filter.isActive = isActive === 'true';

        const [routes, total] = await Promise.all([
            RouteModel.find(filter)
                .sort({ name: 1 })
                .skip(params.skip)
                .limit(params.limit),
            RouteModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(routes, total, params));
    }

    /**
     * GET /routes/:id - Get route with stops
     */
    static async getById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        const route = await RouteModel.findOne({ routeId: id });
        if (!route) return reply.status(404).send({ error: 'Route not found' });

        return reply.send({ success: true, data: route });
    }

    /**
     * PATCH /routes/:id - Update route
     */
    static async update(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const updates = req.body as any;

        const route = await RouteModel.findOneAndUpdate(
            { routeId: id },
            { $set: updates },
            { new: true }
        );

        if (!route) return reply.status(404).send({ error: 'Route not found' });

        return reply.send({ success: true, data: route });
    }

    /**
     * POST /routes/:id/stops - Add stop to route
     */
    static async addStop(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const stopData = AddStopSchema.parse(req.body);

        try {
            const route = await RouteModel.findOne({ routeId: id });
            if (!route) throw new Error('Route not found');

            const stop: RouteStop = {
                stopId: `STOP-${randomUUID()}`,
                name: stopData.name,
                location: {
                    type: 'Point',
                    coordinates: stopData.location.coordinates
                },
                sequence: stopData.sequence,
                estimatedArrivalMinutes: stopData.estimatedArrivalMinutes
            };

            route.stops.push(stop);
            route.stops.sort((a, b) => a.sequence - b.sequence); // Keep sorted
            await route.save();

            return reply.status(201).send({
                success: true,
                message: 'Stop added',
                data: stop
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * DELETE /routes/:id/stops/:stopId - Remove stop
     */
    static async removeStop(req: FastifyRequest, reply: FastifyReply) {
        const { id, stopId } = req.params as { id: string; stopId: string };

        const route = await RouteModel.findOneAndUpdate(
            { routeId: id },
            { $pull: { stops: { stopId } } },
            { new: true }
        );

        if (!route) return reply.status(404).send({ error: 'Route not found' });

        return reply.send({ success: true, message: 'Stop removed' });
    }

    /**
     * POST /routes/:id/access-control - Set route access permissions
     */
    static async setAccessControl(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const accessControl = SetAccessControlSchema.parse(req.body);

        const route = await RouteModel.findOneAndUpdate(
            { routeId: id },
            { $set: { accessControl } },
            { new: true }
        );

        if (!route) return reply.status(404).send({ error: 'Route not found' });

        return reply.send({
            success: true,
            message: 'Access control updated',
            data: route.accessControl
        });
    }
}
