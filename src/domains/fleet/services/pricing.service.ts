import { RoutePricingModel, IRoutePricing, RouteFare } from '../models/route-pricing.model';
import { RouteModel, IRoute } from '../models/route.model';
import { BranchModel } from '../models/branch.model';
import { v4 as uuidv4 } from 'uuid';

export interface CanonicalStop {
    stopId: string;
    branchId: string;
    name: string;
    sequence: number;
    estimatedArrivalMinutes: number;
    distanceKm?: number;
    price?: number;       // cumulative fare from route origin (pesewas)
    isTerminal: boolean;  // true for origin and destination branches
    location?: { type: string; coordinates: [number, number] };
}

export class PricingService {
    /**
     * Build the full ordered stop list for a route including origin (seq 0)
     * and destination (seq = maxIntermediateSeq + 1).
     *
     * This is the single source of truth for stop ordering used by:
     *  - fare matrix generation
     *  - fare calculation
     *  - seat availability sequence mapping
     */
    static getCanonicalStops(route: IRoute): CanonicalStop[] {
        const sorted = [...route.stops].sort((a, b) => a.sequence - b.sequence);
        const maxSeq = sorted.length > 0 ? sorted[sorted.length - 1].sequence : 0;

        const canonical: CanonicalStop[] = [
            {
                stopId: route.originBranchId,
                branchId: route.originBranchId,
                name: 'Origin',            // enriched with branch name by callers if needed
                sequence: 0,
                estimatedArrivalMinutes: 0,
                distanceKm: 0,
                price: 0,
                isTerminal: true,
                location: undefined
            },
            ...sorted.map(s => ({
                stopId: s.stopId,
                branchId: s.branchId,
                name: s.name,
                sequence: s.sequence,
                estimatedArrivalMinutes: s.estimatedArrivalMinutes,
                distanceKm: (s as any).distanceKm,
                price: s.price,
                isTerminal: false,
                location: s.location
            })),
            {
                stopId: route.destinationBranchId,
                branchId: route.destinationBranchId,
                name: 'Destination',       // enriched with branch name by callers if needed
                sequence: maxSeq + 1,
                estimatedArrivalMinutes: route.estimatedDuration,
                distanceKm: undefined,
                price: route.basePrice,
                isTerminal: true,
                location: undefined
            }
        ];

        return canonical;
    }

    /**
     * Calculate fare between any two stops (or branches) on a route.
     *
     * Priority:
     *  1. STOP_PRICE  — stop.price is cumulative from origin; compute delta for mid-route
     *  2. MATRIX      — explicit entry in active RoutePricing.fares
     *  3. FARE_RULE   — DISTANCE / ZONE / FLAT algorithmic rule
     *  4. REVERSE     — symmetric lookup in matrix (backwards journey support)
     *  5. BASE_PRICE  — full route origin → destination fallback
     */
    static async calculateFare(
        routeId: string,
        fromStopId: string,
        toStopId: string
    ): Promise<{ price: number; currency: string; breakdown?: any }> {
        const route = await RouteModel.findOne({ routeId });
        if (!route) throw new Error('Route not found');

        if (fromStopId === toStopId) {
            return { price: 0, currency: 'GHS' };
        }

        const canonical = this.getCanonicalStops(route);
        const fromStop = canonical.find(s => s.stopId === fromStopId);
        const toStop   = canonical.find(s => s.stopId === toStopId);

        // 1. STOP_PRICE: stop.price is cumulative fare from origin.
        //    For a booking starting at origin the full cumPrice is used.
        //    For mid-route bookings, subtract the departure stop's cumPrice.
        if (toStop?.price !== undefined && fromStop?.price !== undefined) {
            const delta = toStop.price - fromStop.price;
            if (delta > 0) {
                return {
                    price: delta,
                    currency: 'GHS',
                    breakdown: {
                        type: 'STOP_PRICE',
                        fromStop: fromStop.name,
                        toStop: toStop.name,
                        fromCumPrice: fromStop.price,
                        toCumPrice: toStop.price,
                        note: 'Cumulative price delta between stops'
                    }
                };
            }
        }

        // 2. MATRIX / FARE_RULE from active RoutePricing
        const pricing = await RoutePricingModel.findOne({
            routeId,
            isActive: true,
            effectiveFrom: { $lte: new Date() },
            $or: [
                { effectiveTo: { $exists: false } },
                { effectiveTo: { $gte: new Date() } }
            ]
        }).sort({ effectiveFrom: -1 });

        if (pricing) {
            const fare = pricing.fares.find(
                f => f.fromStopId === fromStopId && f.toStopId === toStopId
            );

            if (fare) {
                return {
                    price: fare.price,
                    currency: 'GHS',
                    breakdown: {
                        type: 'MATRIX',
                        fromStop: fare.fromStopName,
                        toStop: fare.toStopName,
                        baseFare: fare.price,
                        distanceKm: fare.distance
                    }
                };
            }

            // 3. Fare rule (DISTANCE / ZONE / FLAT)
            if (pricing.fareRule) {
                return this.calculateFareByRule(pricing.fareRule, route, fromStopId, toStopId);
            }

            // 4. Symmetric reverse lookup (supports bidirectional routes)
            const reverseFare = pricing.fares.find(
                f => f.fromStopId === toStopId && f.toStopId === fromStopId
            );
            if (reverseFare) {
                return {
                    price: reverseFare.price,
                    currency: 'GHS',
                    breakdown: {
                        type: 'REVERSE_MATRIX',
                        fromStop: reverseFare.toStopName,
                        toStop: reverseFare.fromStopName,
                        note: 'Symmetric reverse-direction fare applied'
                    }
                };
            }
        }

        // 5. BASE_PRICE fallback — only for full origin → destination journey
        const isFullRoute =
            (fromStopId === route.originBranchId && toStopId === route.destinationBranchId) ||
            (fromStopId === route.destinationBranchId && toStopId === route.originBranchId);

        if (isFullRoute) {
            return {
                price: route.basePrice,
                currency: 'GHS',
                breakdown: { type: 'BASE_PRICE', note: 'Route base price (full journey)' }
            };
        }

        // Resolve human-readable names for the error message
        const fromName = fromStop?.name
            ?? (await BranchModel.findOne({ branchId: fromStopId }))?.name
            ?? fromStopId;
        const toName = toStop?.name
            ?? (await BranchModel.findOne({ branchId: toStopId }))?.name
            ?? toStopId;

        throw new Error(
            `No fare defined for journey from "${fromName}" to "${toName}". ` +
            `Please configure pricing for this route.`
        );
    }

    /**
     * Calculate fare using distance/zone/flat rules
     */
    private static calculateFareByRule(
        fareRule: any,
        route: IRoute,
        fromStopId: string,
        toStopId: string
    ): { price: number; currency: string; breakdown: any } {
        switch (fareRule.type) {
            case 'FLAT':
                return {
                    price: route.basePrice,
                    currency: 'GHS',
                    breakdown: { type: 'FLAT', basePrice: route.basePrice }
                };

            case 'DISTANCE': {
                const distance = this.calculateStopDistance(route, fromStopId, toStopId);
                const price = (fareRule.baseRate || 0) + (distance * (fareRule.perKmRate || 0));
                return {
                    price: Math.round(price),
                    currency: 'GHS',
                    breakdown: {
                        type: 'DISTANCE',
                        distanceKm: parseFloat(distance.toFixed(2)),
                        baseRate: fareRule.baseRate,
                        perKmRate: fareRule.perKmRate
                    }
                };
            }

            case 'ZONE': {
                const fromZone = fareRule.zoneDefinitions?.find((z: any) =>
                    z.stopIds.includes(fromStopId)
                );
                const toZone = fareRule.zoneDefinitions?.find((z: any) =>
                    z.stopIds.includes(toStopId)
                );
                if (fromZone?.zoneId === toZone?.zoneId && fromZone?.intraCityPrice) {
                    return {
                        price: fromZone.intraCityPrice,
                        currency: 'GHS',
                        breakdown: { type: 'ZONE', zone: fromZone.zoneId }
                    };
                }
                break;
            }
        }

        throw new Error('Unable to calculate fare with given rule');
    }

    /**
     * Haversine distance between two stops (uses cumulative distanceKm if stored,
     * otherwise falls back to coordinate-based calculation)
     */
    private static calculateStopDistance(route: IRoute, fromStopId: string, toStopId: string): number {
        const canonical = this.getCanonicalStops(route);
        const from = canonical.find(s => s.stopId === fromStopId);
        const to   = canonical.find(s => s.stopId === toStopId);

        // Use stored cumulative distances when available
        if (from?.distanceKm !== undefined && to?.distanceKm !== undefined) {
            return Math.abs(to.distanceKm - from.distanceKm);
        }

        if (!from?.location || !to?.location) return 0;

        const R = 6371;
        const lat1 = from.location.coordinates[1];
        const lon1 = from.location.coordinates[0];
        const lat2 = to.location.coordinates[1];
        const lon2 = to.location.coordinates[0];

        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);

        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;

        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private static toRad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    /**
     * Compute cumulative Haversine distance (km) for each stop from origin.
     * Returns a map of stopId → distanceKm.
     */
    static computeCumulativeDistances(
        route: IRoute,
        branchCoords: Map<string, [number, number]>
    ): Map<string, number> {
        const canonical = this.getCanonicalStops(route);

        // Resolve coordinates for each canonical stop
        const coords: ([number, number] | undefined)[] = canonical.map(s => {
            if (s.location?.coordinates) return s.location.coordinates;
            return branchCoords.get(s.branchId);
        });

        const distances = new Map<string, number>();
        let cumulative = 0;

        for (let i = 0; i < canonical.length; i++) {
            if (i === 0) {
                distances.set(canonical[i].stopId, 0);
                continue;
            }
            const prev = coords[i - 1];
            const curr = coords[i];
            if (prev && curr) {
                const R = 6371;
                const dLat = this.toRad(curr[1] - prev[1]);
                const dLon = this.toRad(curr[0] - prev[0]);
                const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos(this.toRad(prev[1])) * Math.cos(this.toRad(curr[1])) *
                    Math.sin(dLon / 2) ** 2;
                cumulative += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            }
            distances.set(canonical[i].stopId, parseFloat(cumulative.toFixed(2)));
        }

        return distances;
    }

    /**
     * Create or update pricing for a route (creates a new versioned record)
     */
    static async setPricing(
        routeId: string,
        tenantId: string,
        userId: string,
        pricingData: {
            fares?: RouteFare[];
            fareRule?: any;
            effectiveFrom: Date;
            effectiveTo?: Date;
            notes?: string;
        }
    ): Promise<IRoutePricing> {
        await RoutePricingModel.updateMany(
            { routeId, isActive: true },
            { $set: { isActive: false, effectiveTo: new Date() } }
        );

        const lastPricing = await RoutePricingModel.findOne({ routeId }).sort({ version: -1 });
        const version = (lastPricing?.version || 0) + 1;

        return RoutePricingModel.create({
            routePricingId: `PRICING-${uuidv4()}`,
            routeId,
            tenantId,
            fares: pricingData.fares || [],
            fareRule: pricingData.fareRule,
            version,
            effectiveFrom: pricingData.effectiveFrom,
            effectiveTo: pricingData.effectiveTo,
            isActive: true,
            createdBy: userId,
            notes: pricingData.notes
        });
    }

    /**
     * Get current active pricing for a route
     */
    static async getActivePricing(routeId: string): Promise<IRoutePricing | null> {
        return RoutePricingModel.findOne({
            routeId,
            isActive: true,
            effectiveFrom: { $lte: new Date() },
            $or: [
                { effectiveTo: { $exists: false } },
                { effectiveTo: { $gte: new Date() } }
            ]
        }).sort({ effectiveFrom: -1 });
    }

    /**
     * Generate the full stop-to-stop fare matrix template for a route.
     *
     * Includes ALL pairs: origin↔stops, stops↔destination, stop↔stop.
     * Prices are seeded from cumulative stop.price deltas where available,
     * or left at 0 for the operator to fill in.
     */
    static async generateFareMatrix(routeId: string): Promise<RouteFare[]> {
        const route = await RouteModel.findOne({ routeId });
        if (!route) throw new Error('Route not found');

        // Fetch branch names for origin/destination
        const [originBranch, destBranch] = await Promise.all([
            BranchModel.findOne({ branchId: route.originBranchId }).select('name coordinates').lean(),
            BranchModel.findOne({ branchId: route.destinationBranchId }).select('name coordinates').lean()
        ]);

        const canonical = this.getCanonicalStops(route);

        // Enrich terminal names
        if (originBranch) canonical[0].name = originBranch.name;
        if (destBranch)   canonical[canonical.length - 1].name = destBranch.name;

        // Build branch coords map for distance computation
        const branchCoords = new Map<string, [number, number]>();
        if (originBranch?.coordinates?.coordinates) branchCoords.set(route.originBranchId, originBranch.coordinates.coordinates as [number, number]);
        if (destBranch?.coordinates?.coordinates)   branchCoords.set(route.destinationBranchId, destBranch.coordinates.coordinates as [number, number]);

        const cumDistances = this.computeCumulativeDistances(route, branchCoords);

        const fares: RouteFare[] = [];

        // Generate all forward pairs (i → j, i < j)
        for (let i = 0; i < canonical.length; i++) {
            for (let j = i + 1; j < canonical.length; j++) {
                const from = canonical[i];
                const to   = canonical[j];

                // Price from cumulative stop.price deltas (if both defined and positive delta)
                let price = 0;
                if (from.price !== undefined && to.price !== undefined) {
                    price = Math.max(to.price - from.price, 0);
                }

                const fromDist = cumDistances.get(from.stopId) ?? 0;
                const toDist   = cumDistances.get(to.stopId)   ?? 0;

                fares.push({
                    fromStopId:   from.stopId,
                    fromStopName: from.name,
                    toStopId:     to.stopId,
                    toStopName:   to.name,
                    price,
                    distance: parseFloat(Math.abs(toDist - fromDist).toFixed(2))
                });
            }
        }

        return fares;
    }

    /**
     * Validate that all stop pairs in a route have fares defined.
     * Returns missing pairs as human-readable strings.
     */
    static async validateFareMatrix(
        routeId: string,
        fares: RouteFare[]
    ): Promise<{ isValid: boolean; missingFares: string[] }> {
        const route = await RouteModel.findOne({ routeId });
        if (!route) throw new Error('Route not found');

        const canonical = this.getCanonicalStops(route);
        const missingFares: string[] = [];

        for (let i = 0; i < canonical.length; i++) {
            for (let j = i + 1; j < canonical.length; j++) {
                const a = canonical[i].stopId;
                const b = canonical[j].stopId;
                const exists = fares.some(
                    f => (f.fromStopId === a && f.toStopId === b) ||
                         (f.fromStopId === b && f.toStopId === a)
                );
                if (!exists) {
                    missingFares.push(`${canonical[i].name} → ${canonical[j].name}`);
                }
            }
        }

        return { isValid: missingFares.length === 0, missingFares };
    }
}
