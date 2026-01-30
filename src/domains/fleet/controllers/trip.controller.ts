import { FastifyRequest, FastifyReply } from 'fastify';
import { TripModel, TripStatus } from '../models/trip.model';
import { VehicleModel, VehicleStatus } from '../models/vehicle.model';
import { DriverModel, DriverStatus } from '../../identity/models/driver.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const StartTripSchema = z.object({
    scheduleId: z.string().optional(),
    routeId: z.string(),
    vehicleId: z.string(),
    driverId: z.string(),
    operatorId: z.string()
});

export class TripController {

    /**
     * POST /trips/start - Driver starts a trip
     */
    static async start(req: FastifyRequest, reply: FastifyReply) {
        const body = StartTripSchema.parse(req.body);

        try {
            // Verify vehicle and driver are available
            const [vehicle, driver] = await Promise.all([
                VehicleModel.findOne({ vehicleId: body.vehicleId }),
                DriverModel.findOne({ driverId: body.driverId })
            ]);

            if (!vehicle) throw new Error('Vehicle not found');
            if (!driver) throw new Error('Driver not found');
            if (vehicle.status === VehicleStatus.ON_TRIP) {
                throw new Error('Vehicle already on trip');
            }
            if (driver.status === DriverStatus.ON_TRIP) {
                throw new Error('Driver already on trip');
            }

            // Create trip
            const trip = await TripModel.create({
                tripId: `TRIP-${randomUUID()}`,
                ...body,
                status: TripStatus.IN_PROGRESS,
                departureTime: new Date(),
                currentStopIndex: 0
            });

            // Update vehicle and driver status
            await Promise.all([
                VehicleModel.updateOne(
                    { vehicleId: body.vehicleId },
                    { status: VehicleStatus.ON_TRIP }
                ),
                DriverModel.updateOne(
                    { driverId: body.driverId },
                    { status: DriverStatus.ON_TRIP }
                )
            ]);

            return reply.status(201).send({
                success: true,
                message: 'Trip started',
                data: trip
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /trips/:id/update-stop - Driver marks arrival/departure at stop
     */
    static async updateStop(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { stopIndex } = z.object({ stopIndex: z.number() }).parse(req.body);

        const trip = await TripModel.findOneAndUpdate(
            { tripId: id },
            { currentStopIndex: stopIndex },
            { new: true }
        );

        if (!trip) return reply.status(404).send({ error: 'Trip not found' });

        return reply.send({
            success: true,
            message: `Updated to stop ${stopIndex}`,
            data: trip
        });
    }

    /**
     * POST /trips/:id/complete - Driver completes trip
     */
    static async complete(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        try {
            const trip = await TripModel.findOne({ tripId: id });
            if (!trip) throw new Error('Trip not found');

            trip.status = TripStatus.COMPLETED;
            trip.arrivalTime = new Date();
            await trip.save();

            // Free up vehicle and driver
            await Promise.all([
                VehicleModel.updateOne(
                    { vehicleId: trip.vehicleId },
                    { status: VehicleStatus.ACTIVE }
                ),
                DriverModel.updateOne(
                    { driverId: trip.driverId },
                    { status: DriverStatus.ACTIVE, $inc: { totalTrips: 1 } }
                )
            ]);

            // Auto-transition vehicle to next route if multi-route assigned
            const vehicle = await VehicleModel.findOne({ vehicleId: trip.vehicleId });
            if (vehicle && vehicle.assignedRoutes.length > 1) {
                const nextIndex = (vehicle.currentRouteIndex + 1) % vehicle.assignedRoutes.length;
                vehicle.currentRouteIndex = nextIndex;
                await vehicle.save();
            }

            return reply.send({
                success: true,
                message: 'Trip completed successfully',
                data: trip
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /trips/active?routeId=X - Get active trips on a route
     */
    static async getActive(req: FastifyRequest, reply: FastifyReply) {
        const { routeId } = req.query as any;

        const filter: any = { status: TripStatus.IN_PROGRESS };
        if (routeId) filter.routeId = routeId;

        const trips = await TripModel.find(filter)
            .sort({ departureTime: -1 })
            .limit(20);

        return reply.send({ success: true, data: trips });
    }
}
