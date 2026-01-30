import { FastifyRequest, FastifyReply } from 'fastify';
import { FleetService } from '../services/fleet.service';
import { z } from 'zod';
import { cacheService } from '../../../shared/kernel/cache.service';

const fleetService = new FleetService();

const TelemetrySchema = z.object({
    lat: z.number(),
    lng: z.number(),
    heading: z.number(),
    speed: z.number(),
    vehicleId: z.string()
});

export class FleetController {

    static async updateLocation(req: FastifyRequest, reply: FastifyReply) {
        const { vehicleId, lat, lng, heading, speed } = TelemetrySchema.parse(req.body);

        try {
            const result = await fleetService.updateVehicleLocation(vehicleId, lat, lng, heading, speed);

            // Invalidate nearby cache for this location
            await cacheService.delPattern(`fleet:nearby:*`);

            return reply.send(result);
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    static async findNearby(req: FastifyRequest, reply: FastifyReply) {
        const { lat, lng } = req.query as any;

        if (!lat || !lng) return reply.status(400).send({ error: 'Missing lat/lng' });

        const cacheKey = `fleet:nearby:${lat}:${lng}`;

        const buses = await cacheService.wrap(
            cacheKey,
            () => fleetService.findNearbyVehicles(parseFloat(lat), parseFloat(lng)),
            30 // Cache for 30 seconds (vehicles move fast)
        );

        return reply.send(buses);
    }
}
