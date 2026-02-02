import { FastifyRequest, FastifyReply } from 'fastify';
import { RouteModel, RouteStop } from '../models/route.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';
import { PricingService } from '../services/pricing.service';
import { BranchService } from '../services/branch.service';

const StopInputSchema = z.object({
    branchId: z.string(),
    name: z.string(),
    location: z.object({
        coordinates: z.tuple([z.number(), z.number()])
    }).optional(),
    sequence: z.number(),
    estimatedArrivalMinutes: z.number(),
    price: z.number().optional()
});

const CreateRouteSchema = z.object({
    name: z.string(),
    operatorId: z.string().optional(),
    originBranchId: z.string(),
    destinationBranchId: z.string(),
    isActive: z.boolean().optional(),
    geometry: z.object({
        coordinates: z.array(z.array(z.number()))
    }).optional(),
    basePrice: z.number(),
    estimatedDuration: z.number(),
    stops: z.array(StopInputSchema).optional()
});

const AddStopSchema = StopInputSchema;

const SetAccessControlSchema = z.object({
    allowedRoles: z.array(z.string()).optional(),
    allowedOperators: z.array(z.string()).optional(),
    restrictedTenants: z.array(z.string()).optional()
});

export class RouteController {

    /**
     * Helper to populate coordinates for stops if missing
     */
    private static async populateStopCoordinates(stops: any[], tenantId: string): Promise<RouteStop[]> {
        const processedStops: RouteStop[] = [];

        for (const stop of stops) {
            let location = stop.location;

            // If location/coordinates missing, try to fetch from branch
            if ((!location || !location.coordinates) && stop.branchId) {
                try {
                    const branch = await BranchService.getBranchById(stop.branchId, tenantId);
                    if (branch?.coordinates?.coordinates) {
                        location = {
                            type: 'Point',
                            coordinates: branch.coordinates.coordinates
                        };
                    }
                } catch (e) {
                    console.error(`Failed to fetch branch coordinates for stop ${stop.name}`, e);
                }
            }

            // Default fallback if still missing (prevent crash, but data might be invalid geometry)
            if (!location) {
                location = { type: 'Point', coordinates: [0, 0] };
            }

            processedStops.push({
                stopId: stop.stopId || `STOP-${randomUUID()}`,
                branchId: stop.branchId,
                name: stop.name,
                location,
                sequence: stop.sequence,
                estimatedArrivalMinutes: stop.estimatedArrivalMinutes,
                price: stop.price
            });
        }
        return processedStops.sort((a, b) => a.sequence - b.sequence);
    }


    /**
     * Helper to construct route geometry from origin -> stops -> destination
     */
    private static async buildRouteGeometry(
        originBranchId: string,
        destinationBranchId: string,
        stops: RouteStop[],
        explicitGeometry: number[][] | undefined,
        tenantId: string
    ): Promise<{ type: string; coordinates: number[][] }> {
        // 1. Use explicit geometry if valid (>= 2 points)
        if (explicitGeometry && explicitGeometry.length >= 2) {
            return {
                type: 'LineString',
                coordinates: explicitGeometry
            };
        }

        // 2. Construct from branches and stops
        let pathCoordinates: number[][] = [];
        try {
            const [originBranch, destBranch] = await Promise.all([
                BranchService.getBranchById(originBranchId, tenantId),
                BranchService.getBranchById(destinationBranchId, tenantId)
            ]);

            // Add Origin
            if (originBranch?.coordinates?.coordinates) {
                pathCoordinates.push(originBranch.coordinates.coordinates);
            } else {
                pathCoordinates.push([0, 0]); // Fallback
            }

            // Add Intermediate Stops
            if (stops && stops.length > 0) {
                stops.forEach(stop => {
                    if (stop.location?.coordinates) {
                        pathCoordinates.push(stop.location.coordinates);
                    }
                });
            }

            // Add Destination
            if (destBranch?.coordinates?.coordinates) {
                pathCoordinates.push(destBranch.coordinates.coordinates);
            } else {
                pathCoordinates.push([0, 0]); // Fallback
            }

        } catch (e) {
            console.error("Failed to construct geometry from branches", e);
            // Fallback to simple line
            return { type: 'LineString', coordinates: [[0, 0], [0, 0]] };
        }

        // 3. Ensure validity (>= 2 points)
        if (pathCoordinates.length < 2) {
            // If we have 1 point (e.g. same origin/dest and no stops), add a slight offset or duplicate to make it valid
            if (pathCoordinates.length === 1) {
                pathCoordinates.push(pathCoordinates[0]);
            } else {
                return { type: 'LineString', coordinates: [[0, 0], [0, 0]] };
            }
        }

        return {
            type: 'LineString',
            coordinates: pathCoordinates
        };
    }

    /**
     * POST /routes - Create route
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateRouteSchema.parse(req.body);
        // @ts-ignore
        const { tenantId } = req.user || {};

        try {
            let stops: RouteStop[] = [];
            if (body.stops && body.stops.length > 0) {
                stops = await RouteController.populateStopCoordinates(body.stops, tenantId);
            }

            const geometry = await RouteController.buildRouteGeometry(
                body.originBranchId,
                body.destinationBranchId,
                stops,
                body.geometry?.coordinates,
                tenantId
            );

            const route = await RouteModel.create({
                routeId: `ROUTE-${randomUUID()}`,
                name: body.name,
                operatorId: body.operatorId || tenantId,
                originBranchId: body.originBranchId,
                destinationBranchId: body.destinationBranchId,
                isActive: body.isActive ?? true,
                basePrice: body.basePrice,
                estimatedDuration: body.estimatedDuration,
                geometry: geometry, // Use robust geometry
                stops: stops,
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
        // @ts-ignore
        const { tenantId, branchIds, roles } = req.user || {};
        const { operatorId, isActive, branchId } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = {};
        if (tenantId) filter.operatorId = tenantId;
        else if (operatorId) filter.operatorId = operatorId;

        if (isActive !== undefined) filter.isActive = isActive === 'true';

        // Branch Scoping for Routes
        // If user is restricted to branches, show routes that start OR end in those branches
        if (roles && !roles.includes('SUPER_ADMIN') && branchIds && branchIds.length > 0) {
            filter.$or = [
                { originBranchId: { $in: branchIds } },
                { destinationBranchId: { $in: branchIds } }
            ];
            // If branchId param is provided, strictly filter by it (origin or dest)
            if (branchId) {
                // Ensure user has access
                if (branchIds.includes(branchId)) {
                    filter.$or = [
                        { originBranchId: branchId },
                        { destinationBranchId: branchId }
                    ];
                } else {
                    return reply.send(createPaginatedResponse([], 0, params));
                }
            }
        } else if (branchId) {
            // Super admin filtering
            filter.$or = [
                { originBranchId: branchId },
                { destinationBranchId: branchId }
            ];
        }

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
        // @ts-ignore
        const { tenantId } = req.user || {};

        if (updates.stops) {
            updates.stops = await RouteController.populateStopCoordinates(updates.stops, tenantId);
        }

        // Fetch current route to check for changes if not provided in updates
        const currentRoute = await RouteModel.findOne({ routeId: id });
        if (!currentRoute) return reply.status(404).send({ error: 'Route not found' });

        // Check if we need to rebuild geometry
        // We rebuild if stops, origin, destination, or geometry is explicitly updated
        const originId = updates.originBranchId || currentRoute.originBranchId;
        const destId = updates.destinationBranchId || currentRoute.destinationBranchId;
        const stopsToUse = updates.stops || currentRoute.stops;

        // If explicit geometry is invalid (e.g. coming from frontend as [0,0]), force rebuild
        // The frontend sends coordinates: [[0,0]] when it doesn't know the path.
        // We treat <= 1 point or [0,0] as invalid explicit geometry.
        let explicitGeo = updates.geometry?.coordinates;
        const isExplicitInvalid = !explicitGeo || explicitGeo.length < 2 || (explicitGeo.length === 1 && explicitGeo[0][0] === 0);

        if (isExplicitInvalid) {
            explicitGeo = undefined; // Ignore invalid input from frontend
        }

        const geometry = await RouteController.buildRouteGeometry(
            originId,
            destId,
            stopsToUse,
            explicitGeo,
            tenantId
        );

        updates.geometry = geometry;

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
        // @ts-ignore
        const { tenantId } = req.user || {};

        try {
            const route = await RouteModel.findOne({ routeId: id });
            if (!route) throw new Error('Route not found');

            const [stop] = await RouteController.populateStopCoordinates([stopData], tenantId);

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
            message: 'Access control updated',
            data: route.accessControl
        });
    }

    /**
     * POST /routes/:id/pricing - Set pricing for route
     */
    static async setPricing(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        // @ts-ignore
        const { tenantId, userId } = req.user || {};

        const body = req.body as any;

        try {
            const pricing = await PricingService.setPricing(
                id,
                tenantId,
                userId,
                {
                    fares: body.fares,
                    fareRule: body.fareRule,
                    effectiveFrom: new Date(body.effectiveFrom),
                    effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
                    notes: body.notes
                }
            );

            return reply.status(201).send({
                success: true,
                message: 'Pricing set successfully',
                data: pricing
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /routes/:id/pricing - Get current pricing
     */
    static async getPricing(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        try {
            const pricing = await PricingService.getActivePricing(id);

            if (!pricing) {
                return reply.status(404).send({ error: 'No active pricing found' });
            }

            return reply.send({ success: true, data: pricing });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /routes/:id/pricing/calculate - Calculate fare
     */
    static async calculateFare(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { fromStopId, toStopId } = req.body as any;

        if (!fromStopId || !toStopId) {
            return reply.status(400).send({
                error: 'fromStopId and toStopId are required'
            });
        }

        try {
            const fareInfo = await PricingService.calculateFare(id, fromStopId, toStopId);
            return reply.send({ success: true, data: fareInfo });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /routes/:id/pricing/matrix - Generate fare matrix template
     */
    static async generateFareMatrix(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        try {
            const matrix = await PricingService.generateFareMatrix(id);
            return reply.send({
                success: true,
                data: matrix,
                count: matrix.length
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /routes/:id/pricing/validate - Validate fare matrix
     */
    static async validateFareMatrix(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { fares } = req.body as any;

        try {
            const validation = await PricingService.validateFareMatrix(id, fares);
            return reply.send({ success: true, data: validation });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }
}
