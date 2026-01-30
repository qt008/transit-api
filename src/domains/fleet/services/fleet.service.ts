import { VehicleModel, VehicleStatus } from '../models/vehicle.model';
import { RouteModel } from '../models/route.model';
import { EventEmitter } from 'events';

// In production, use Redis Pub/Sub so multiple API nodes can broadcast
export const fleetEvents = new EventEmitter();

export class FleetService {

    /**
     * Updates vehicle telemetry and broadcasts to subscribers.
     */
    async updateVehicleLocation(
        vehicleId: string,
        lat: number,
        lng: number,
        heading: number,
        speed: number
    ) {
        const vehicle = await VehicleModel.findOneAndUpdate(
            { vehicleId },
            {
                location: { type: 'Point', coordinates: [lng, lat] },
                heading,
                speed,
                lastPing: new Date(),
                status: VehicleStatus.ACTIVE
            },
            { new: true, upsert: false }
        );

        if (!vehicle) { // Vehicle must exist (registered by admin)
            throw new Error('Vehicle not registered');
        }

        // 1. Calculate simplified ETA if on active trip
        let etaMinutes = null;
        if (vehicle.assignedRoutes && vehicle.assignedRoutes.length > 0) {
            // In real implementation: Call Google Routes API or OSRM
            // Here: Simple distance calculation
            etaMinutes = await this.calculateMockETA(vehicle);
        }

        // 2. Broadcast via WebSocket (Simulation)
        const currentRouteId = vehicle.assignedRoutes && vehicle.assignedRoutes.length > 0
            ? vehicle.assignedRoutes[vehicle.currentRouteIndex]
            : null;

        const payload = {
            vehicleId,
            location: [lng, lat],
            heading,
            routeId: currentRouteId,
            eta: etaMinutes
        };

        // fleetEvents.emit('vehicle:location', payload);

        return payload;
    }

    async findNearbyVehicles(lat: number, lng: number, radiusMeters: number = 1000) {
        return VehicleModel.find({
            location: {
                $near: {
                    $geometry: { type: 'Point', coordinates: [lng, lat] },
                    $maxDistance: radiusMeters
                }
            },
            status: VehicleStatus.ACTIVE
        });
    }

    private async calculateMockETA(vehicle: any): Promise<number> {
        // Mock logic: 10 mins remaining
        return 10;
    }
}
