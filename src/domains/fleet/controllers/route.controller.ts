import { FastifyRequest, FastifyReply } from 'fastify';
import { RouteModel, RouteStop } from '../models/route.model';
import { BranchModel } from '../models/branch.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';
import { PricingService } from '../services/pricing.service';
import { BranchService } from '../services/branch.service';
import { RoutePricingModel } from '../models/route-pricing.model';

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
     * Helper to populate coordinates for stops if missing.
     * Also computes cumulative distanceKm from the origin for each stop using
     * the Haversine formula so the value is always stored alongside the stop.
     */
    private static async populateStopCoordinates(
        stops: any[],
        tenantId: string,
        originCoords?: [number, number]
    ): Promise<RouteStop[]> {
        const processedStops: RouteStop[] = [];

        for (const stop of stops) {
            let location = stop.location;

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
                // distanceKm is computed below after sorting
            } as RouteStop);
        }

        const sorted = processedStops.sort((a, b) => a.sequence - b.sequence);

        // Compute cumulative Haversine distance from origin for each intermediate stop.
        if (originCoords) {
            let prev: [number, number] = originCoords;
            let cumKm = 0;
            for (const stop of sorted) {
                const curr = stop.location?.coordinates as [number, number] | undefined;
                if (curr && (curr[0] !== 0 || curr[1] !== 0)) {
                    cumKm += RouteController.haversineKm(prev, curr);
                    prev = curr;
                }
                (stop as any).distanceKm = parseFloat(cumKm.toFixed(2));
            }
        }

        return sorted;
    }

    /** Haversine distance in km between two [lng, lat] points */
    private static haversineKm(a: [number, number], b: [number, number]): number {
        const R = 6371;
        const toRad = (d: number) => d * Math.PI / 180;
        const dLat = toRad(b[1] - a[1]);
        const dLon = toRad(b[0] - a[0]);
        const sinA = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA));
    }

    /**
     * Recompute cumulative distanceKm for an already-sorted stop array.
     * Mutates each stop's distanceKm in place. Called after any structural change
     * (update, addStop, removeStop) so the stored distances stay accurate.
     */
    private static assignCumulativeDistances(
        sortedStops: RouteStop[],
        originCoords: [number, number]
    ): void {
        let prev: [number, number] = originCoords;
        let cumKm = 0;
        for (const stop of sortedStops) {
            const curr = stop.location?.coordinates as [number, number] | undefined;
            if (curr && (curr[0] !== 0 || curr[1] !== 0)) {
                cumKm += RouteController.haversineKm(prev, curr);
                prev = curr;
            }
            (stop as any).distanceKm = parseFloat(cumKm.toFixed(2));
        }
    }

    /**
     * Sanitizes an array of coordinates for MongoDB's 2dsphere index.
     * Removes consecutive duplicate coordinates. If only 1 unique point remains,
     * adds a tiny offset to create a valid LineString.
     */
    private static sanitizeCoordinates(coords: number[][]): number[][] {
        if (!coords || coords.length === 0) return [[0, 0], [0.0001, 0]];
        if (coords.length === 1) return [coords[0], [coords[0][0] + 0.0001, coords[0][1]]];

        const sanitized: number[][] = [coords[0]];
        for (let i = 1; i < coords.length; i++) {
            const prev = sanitized[sanitized.length - 1];
            const curr = coords[i];
            if (prev[0] !== curr[0] || prev[1] !== curr[1]) {
                sanitized.push(curr);
            }
        }

        if (sanitized.length < 2) {
            sanitized.push([sanitized[0][0] + 0.0001, sanitized[0][1]]);
        }
        return sanitized;
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
                coordinates: RouteController.sanitizeCoordinates(explicitGeometry)
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
            return { type: 'LineString', coordinates: RouteController.sanitizeCoordinates([[0, 0], [0, 0]]) };
        }

        return {
            type: 'LineString',
            coordinates: RouteController.sanitizeCoordinates(pathCoordinates)
        };
    }

    /**
     * POST /routes - Create route
     *
     * Auto-seeds an initial RoutePricing record covering ALL stop pairs including
     * origin and destination terminals. Seeding strategy:
     *  - If any stop carries an explicit cumulative price (price > 0):
     *      Build a MATRIX using price deltas (toStop.price - fromStop.price)
     *      for every forward pair in the canonical stop list.
     *  - Otherwise:
     *      Seed a FLAT fare rule — the operator must configure pricing via the
     *      pricing endpoints before fares can be calculated.
     *
     * The 201 response includes a `pricing` preview so operators immediately
     * see what was generated and can refine it if needed.
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateRouteSchema.parse(req.body);
        // @ts-ignore
        const { tenantId, userId } = req.user || {};

        try {
            // Fetch terminal branches up-front so their coordinates can be used
            // for cumulative distance computation during stop population, and
            // re-used for the pricing seed without additional DB round-trips.
            const [originBranch, destBranch] = await Promise.all([
                BranchModel.findOne({ branchId: body.originBranchId }).select('name coordinates').lean(),
                BranchModel.findOne({ branchId: body.destinationBranchId }).select('name coordinates').lean()
            ]);

            const originCoords = originBranch?.coordinates?.coordinates as [number, number] | undefined;

            let stops: RouteStop[] = [];
            if (body.stops && body.stops.length > 0) {
                stops = await RouteController.populateStopCoordinates(body.stops, tenantId, originCoords);
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
                geometry,
                stops,
                accessControl: {
                    allowedRoles: ['PASSENGER'],
                    allowedOperators: [],
                    restrictedTenants: []
                }
            });

            // ── Auto-seed RoutePricing ──────────────────────────────────────────

            // Build the canonical stop list (origin seq 0, intermediates, destination seq N+1)
            const canonical = PricingService.getCanonicalStops(route as any);
            if (originBranch) canonical[0].name = originBranch.name;
            if (destBranch)   canonical[canonical.length - 1].name = destBranch.name;

            // Compute cumulative distances for the matrix
            const branchCoords = new Map<string, [number, number]>();
            if (originBranch?.coordinates?.coordinates) {
                branchCoords.set(body.originBranchId, originBranch.coordinates.coordinates as [number, number]);
            }
            if (destBranch?.coordinates?.coordinates) {
                branchCoords.set(body.destinationBranchId, destBranch.coordinates.coordinates as [number, number]);
            }
            const cumDistances = PricingService.computeCumulativeDistances(route as any, branchCoords);

            // Determine whether we have enough cumulative prices to build a MATRIX.
            // A canonical stop is "priced" if its cumulative price > 0.
            const pricedCanonical = canonical.filter(s => s.price !== undefined && s.price > 0);
            const hasMatrix = pricedCanonical.length >= 2;

            let fares: any[] = [];
            let fareRule: any = undefined;
            let pricingStrategy: string;

            if (hasMatrix) {
                // Build stop-to-stop fare matrix from cumulative price deltas.
                // origin.price = 0, each stop.price = cumulative fare from origin.
                // pair fare = toStop.price - fromStop.price
                for (let i = 0; i < canonical.length; i++) {
                    for (let j = i + 1; j < canonical.length; j++) {
                        const from = canonical[i];
                        const to   = canonical[j];
                        const fromCum = from.price ?? 0;
                        const toCum   = to.price   ?? body.basePrice;
                        const fromDist = cumDistances.get(from.stopId) ?? 0;
                        const toDist   = cumDistances.get(to.stopId)   ?? 0;
                        fares.push({
                            fromStopId:   from.stopId,
                            fromStopName: from.name,
                            toStopId:     to.stopId,
                            toStopName:   to.name,
                            price:        Math.max(toCum - fromCum, 0),
                            distance:     parseFloat(Math.abs(toDist - fromDist).toFixed(2))
                        });
                    }
                }
                pricingStrategy = 'MATRIX';
            } else {
                fareRule = { type: 'FLAT' };
                pricingStrategy = 'FLAT';
            }

            const seedPricing = await RoutePricingModel.create({
                routePricingId: `PRICING-${uuidv4()}`,
                routeId: route.routeId,
                tenantId,
                fares,
                fareRule,
                version: 1,
                effectiveFrom: new Date(),
                isActive: true,
                createdBy: userId || tenantId,
                notes: hasMatrix
                    ? `Auto-generated MATRIX (${fares.length} pairs) from cumulative stop prices`
                    : 'Auto-generated FLAT rule — configure stop-to-stop fares via the pricing endpoints'
            });
            // ───────────────────────────────────────────────────────────────────

            return reply.status(201).send({
                success: true,
                data: route,
                pricing: {
                    strategy: pricingStrategy,
                    pricingId: seedPricing.routePricingId,
                    fareCount: fares.length,
                    fares: fares.map(f => ({
                        from: f.fromStopName,
                        to:   f.toStopName,
                        price: f.price,
                        distanceKm: f.distance ?? null
                    })),
                    note: seedPricing.notes
                }
            });
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

        const currentRoute = await RouteModel.findOne({ routeId: id });
        if (!currentRoute) return reply.status(404).send({ error: 'Route not found' });

        const originId = updates.originBranchId || currentRoute.originBranchId;
        const destId   = updates.destinationBranchId || currentRoute.destinationBranchId;

        // If origin is changing, or stops are being replaced, we need fresh origin coordinates
        // so cumulative distances can be (re)computed correctly.
        const needsOriginCoords = !!(updates.stops || updates.originBranchId);
        let originCoords: [number, number] | undefined;
        if (needsOriginCoords) {
            const originBranch = await BranchModel.findOne({ branchId: originId })
                .select('coordinates').lean();
            originCoords = originBranch?.coordinates?.coordinates as [number, number] | undefined;
        }

        if (updates.stops) {
            updates.stops = await RouteController.populateStopCoordinates(updates.stops, tenantId, originCoords);
        }

        const stopsToUse = updates.stops || currentRoute.stops;

        let explicitGeo = updates.geometry?.coordinates;
        const isExplicitInvalid = !explicitGeo || explicitGeo.length < 2 || (explicitGeo.length === 1 && explicitGeo[0][0] === 0);
        if (isExplicitInvalid) {
            explicitGeo = undefined;
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

            // Fetch origin coordinates so the new stop's distance can be computed
            // and all stops can be re-indexed after insertion.
            const originBranch = await BranchModel.findOne({ branchId: route.originBranchId })
                .select('coordinates').lean();
            const originCoords = originBranch?.coordinates?.coordinates as [number, number] | undefined;

            const [stop] = await RouteController.populateStopCoordinates([stopData], tenantId, originCoords);

            route.stops.push(stop);
            route.stops.sort((a, b) => a.sequence - b.sequence);

            // Recompute cumulative distances for the full sorted stop list
            if (originCoords) {
                RouteController.assignCumulativeDistances(route.stops as RouteStop[], originCoords);
            }

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

        // Pull the stop first, then recompute distances on the remaining stops.
        const route = await RouteModel.findOne({ routeId: id });
        if (!route) return reply.status(404).send({ error: 'Route not found' });

        route.stops = route.stops.filter(s => s.stopId !== stopId) as any;
        route.stops.sort((a: any, b: any) => a.sequence - b.sequence);

        const originBranch = await BranchModel.findOne({ branchId: route.originBranchId })
            .select('coordinates').lean();
        const originCoords = originBranch?.coordinates?.coordinates as [number, number] | undefined;
        if (originCoords) {
            RouteController.assignCumulativeDistances(route.stops as RouteStop[], originCoords);
        }

        await route.save();

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
