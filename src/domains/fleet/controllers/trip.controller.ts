import { FastifyRequest, FastifyReply } from 'fastify';
import { TripModel, TripStatus } from '../models/trip.model';
import { VehicleModel, VehicleStatus } from '../models/vehicle.model';
import { DriverModel, DriverStatus } from '../../identity/models/driver.model';
import { TripService } from '../services/trip.service';
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
            // if (vehicle.status === VehicleStatus.ON_TRIP) {
            //     throw new Error('Vehicle already on trip');
            // }
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

            // Update driver status (vehicle status update removed)
            await DriverModel.updateOne(
                { driverId: body.driverId },
                { status: DriverStatus.ON_TRIP }
            );

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
            trip.actualArrivalTime = new Date();
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

    /**
     * POST /trips/generate - Generate trips from schedule
     */
    static async generateTrips(req: FastifyRequest, reply: FastifyReply) {
        const { scheduleId, startDate, endDate } = z.object({
            scheduleId: z.string(),
            startDate: z.string(),
            endDate: z.string()
        }).parse(req.body);

        // @ts-ignore
        const { userId } = req.user || {};

        try {
            const trips = await TripService.generateTripsFromSchedule(
                scheduleId,
                new Date(startDate),
                new Date(endDate),
                userId || 'SYSTEM'
            );

            return reply.status(201).send({
                success: true,
                message: `Generated ${trips.length} trip(s)`,
                data: trips
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /trips - List trips with filters
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        const query = req.query as any;

        try {
            const trips = await TripService.getTrips({
                routeId: query.routeId,
                branchId: query.branchId,
                vehicleId: query.vehicleId,
                driverId: query.driverId,
                startDate: query.startDate ? new Date(query.startDate) : undefined,
                endDate: query.endDate ? (() => {
                    const d = new Date(query.endDate);
                    d.setHours(23, 59, 59, 999);
                    return d;
                })() : undefined,
                status: query.status
            });

            return reply.send({ success: true, data: trips, count: trips.length });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /trips/:id - Get trip details
     */
    static async getById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        try {
            const trip = await TripModel.findOne({ tripId: id });
            if (!trip) {
                return reply.status(404).send({ error: 'Trip not found' });
            }

            return reply.send({ success: true, data: trip });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /trips/:id/availability - Get seat availability
     */
    static async getAvailability(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        try {
            const availability = await TripService.getTripAvailability(id);
            return reply.send({ success: true, data: availability });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * PATCH /trips/:id/status - Update trip status
     */
    static async updateStatus(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { status } = z.object({ status: z.nativeEnum(TripStatus) }).parse(req.body);

        try {
            const trip = await TripService.updateTripStatus(id, status);
            return reply.send({
                success: true,
                message: 'Trip status updated',
                data: trip
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }
}
