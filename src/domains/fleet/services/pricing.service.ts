import { RoutePricingModel, IRoutePricing, RouteFare } from '../models/route-pricing.model';
import { RouteModel } from '../models/route.model';
import { BranchModel } from '../models/branch.model';
import { v4 as uuidv4 } from 'uuid';

export class PricingService {
    /**
     * Calculate fare between two stops on a route
     */
    static async calculateFare(
        routeId: string,
        fromStopId: string,
        toStopId: string
    ): Promise<{ price: number; currency: string; breakdown?: any }> {
        // 1. Fetch Route details first
        const route = await RouteModel.findOne({ routeId });
        if (!route) throw new Error('Route not found');

        // If same stop, return 0
        if (fromStopId === toStopId) {
            return { price: 0, currency: 'GHS' };
        }

        // 2. Check for Stop-Specific Pricing (Primary Override for Intermediate Stops)
        // If the destination stop has a specific price defined, use it.
        // This assumes the journey starts from the route origin.
        const toStop = route.stops.find(s => s.stopId === toStopId);
        if (toStop && toStop.price !== undefined) {
            return {
                price: toStop.price,
                currency: 'GHS',
                breakdown: {
                    type: 'STOP_PRICE',
                    stopName: toStop.name,
                    note: 'Fixed price to stop'
                }
            };
        }

        // 3. Check for Base Price (Full Route Fallback)
        // If going from Origin -> Destination Branch, and no other pricing is found later, we might use this.
        // But let's check Matrix first as it's more specific.

        // 4. Get active pricing matrix
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
            // Check if fare exists in matrix
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
                        baseFare: fare.price
                    }
                };
            }

            // If no direct fare, apply fare rule if available
            if (pricing.fareRule) {
                return this.calculateFareByRule(
                    pricing.fareRule,
                    routeId, // routeId
                    fromStopId,
                    toStopId
                );
            }

            // Fallback: try reverse direction
            const reverseFare = pricing.fares.find(
                f => f.fromStopId === toStopId && f.toStopId === fromStopId
            );

            if (reverseFare) {
                return {
                    price: reverseFare.price,
                    currency: 'GHS',
                    breakdown: {
                        type: 'REVERSE_MATRIX',
                        note: 'Using reverse direction pricing'
                    }
                };
            }
        }

        // 5. Final Fallback: Route Base Price
        // Apply base price for full route travel in either direction
        // Origin → Destination OR Destination → Origin
        const isFullRoute = (
            (fromStopId === route.originBranchId && toStopId === route.destinationBranchId) ||
            (fromStopId === route.destinationBranchId && toStopId === route.originBranchId)
        );

        if (isFullRoute) {
            return {
                price: route.basePrice,
                currency: 'GHS',
                breakdown: { type: 'BASE_PRICE', note: 'Route base price (bidirectional)' }
            };
        }

        // If we really can't find a price, provide a helpful error with stop/branch names
        const fromStopInfo = route.stops.find(s => s.stopId === fromStopId);
        const toStopInfo = route.stops.find(s => s.stopId === toStopId);

        let fromName = fromStopInfo?.name;
        let toName = toStopInfo?.name;

        // If not found in stops, check if they're branches
        if (!fromName) {
            const fromBranch = await BranchModel.findOne({ branchId: fromStopId });
            fromName = fromBranch?.name || fromStopId;
        }
        if (!toName) {
            const toBranch = await BranchModel.findOne({ branchId: toStopId });
            toName = toBranch?.name || toStopId;
        }

        throw new Error(`No fare defined for journey from "${fromName}" to "${toName}". Please configure pricing for this route.`);
    }

    /**
     * Calculate fare using distance/zone rules
     */
    private static async calculateFareByRule(
        fareRule: any,
        routeId: string,
        fromStopId: string,
        toStopId: string
    ): Promise<{ price: number; currency: string; breakdown: any }> {
        const route = await RouteModel.findOne({ routeId });
        if (!route) throw new Error('Route not found');

        switch (fareRule.type) {
            case 'FLAT':
                return {
                    price: route.basePrice,
                    currency: 'GHS',
                    breakdown: { type: 'FLAT', basePrice: route.basePrice }
                };

            case 'DISTANCE':
                const distance = this.calculateStopDistance(route, fromStopId, toStopId);
                const price = (fareRule.baseRate || 0) + (distance * (fareRule.perKmRate || 0));
                return {
                    price: Math.round(price),
                    currency: 'GHS',
                    breakdown: {
                        type: 'DISTANCE',
                        distance,
                        baseRate: fareRule.baseRate,
                        perKmRate: fareRule.perKmRate
                    }
                };

            case 'ZONE':
                // Simplified zone logic
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

        throw new Error('Unable to calculate fare with given rule');
    }

    /**
     * Estimate distance between stops (simplified)
     */
    private static calculateStopDistance(route: any, fromStopId: string, toStopId: string): number {
        const fromStop = route.stops.find((s: any) => s.stopId === fromStopId);
        const toStop = route.stops.find((s: any) => s.stopId === toStopId);

        if (!fromStop || !toStop) return 0;

        // Use Haversine formula for great-circle distance
        const R = 6371; // Earth's radius in km
        const lat1 = fromStop.location.coordinates[1];
        const lon1 = fromStop.location.coordinates[0];
        const lat2 = toStop.location.coordinates[1];
        const lon2 = toStop.location.coordinates[0];

        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private static toRad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    /**
     * Create or update pricing for a route
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
        // Deactivate current pricing
        await RoutePricingModel.updateMany(
            { routeId, isActive: true },
            { $set: { isActive: false, effectiveTo: new Date() } }
        );

        // Get version number
        const lastPricing = await RoutePricingModel.findOne({ routeId })
            .sort({ version: -1 });
        const version = (lastPricing?.version || 0) + 1;

        // Create new pricing
        const pricing = await RoutePricingModel.create({
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

        return pricing;
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
     * Generate all stop-to-stop combinations for a route
     * Helpful for bulk pricing setup
     */
    static async generateFareMatrix(routeId: string): Promise<RouteFare[]> {
        const route = await RouteModel.findOne({ routeId });
        if (!route) throw new Error('Route not found');

        const fares: RouteFare[] = [];
        const stops = route.stops.sort((a, b) => a.sequence - b.sequence);

        // Generate all combinations where from < to (unidirectional)
        for (let i = 0; i < stops.length; i++) {
            for (let j = i + 1; j < stops.length; j++) {
                fares.push({
                    fromStopId: stops[i].stopId,
                    fromStopName: stops[i].name,
                    toStopId: stops[j].stopId,
                    toStopName: stops[j].name,
                    price: 0, // To be filled manually
                    distance: this.calculateStopDistance(route, stops[i].stopId, stops[j].stopId)
                });
            }
        }

        return fares;
    }

    /**
     * Validate fare matrix completeness
     */
    static async validateFareMatrix(
        routeId: string,
        fares: RouteFare[]
    ): Promise<{ isValid: boolean; missingFares: string[] }> {
        const route = await RouteModel.findOne({ routeId });
        if (!route) throw new Error('Route not found');

        const stops = route.stops.map(s => s.stopId);
        const missingFares: string[] = [];

        // Check all combinations
        for (let i = 0; i < stops.length; i++) {
            for (let j = i + 1; j < stops.length; j++) {
                const fareExists = fares.some(
                    f => (f.fromStopId === stops[i] && f.toStopId === stops[j]) ||
                        (f.fromStopId === stops[j] && f.toStopId === stops[i])
                );

                if (!fareExists) {
                    missingFares.push(`${stops[i]} -> ${stops[j]}`);
                }
            }
        }

        return {
            isValid: missingFares.length === 0,
            missingFares
        };
    }
}
