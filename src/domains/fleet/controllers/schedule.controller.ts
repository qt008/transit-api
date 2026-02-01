import { FastifyRequest, FastifyReply } from 'fastify';
import { ScheduleModel } from '../models/schedule.model';
import { TripModel, TripStatus } from '../models/trip.model';
import { RouteModel } from '../models/route.model';
import { BookingModel, BookingStatus } from '../../ticketing/models/booking.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const CreateScheduleSchema = z.object({
    routeId: z.string(),
    vehicleId: z.string(),
    driverId: z.string(),
    operatorId: z.string().optional(),
    departureTime: z.string().regex(/^\d{2}:\d{2}$/), // HH:MM
    frequency: z.number().default(0),
    daysOfWeek: z.array(z.number().min(0).max(6)),
    validFrom: z.string().transform(str => new Date(str)),
    validTo: z.string().transform(str => new Date(str))
});

export class ScheduleController {

    /**
     * POST /schedules - Create schedule
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateScheduleSchema.parse(req.body);
        // @ts-ignore
        const { tenantId } = req.user || {};

        try {
            // 1. Fetch Route for new schedule to get duration
            const route = await RouteModel.findOne({ routeId: body.routeId });
            if (!route) return reply.status(404).send({ error: 'Route not found' });

            // 2. Check for conflicts
            const conflicts = await ScheduleModel.aggregate([
                {
                    $match: {
                        isActive: true,
                        operatorId: body.operatorId || tenantId,
                        $or: [{ driverId: body.driverId }, { vehicleId: body.vehicleId }],
                        daysOfWeek: { $in: body.daysOfWeek }
                    }
                },
                {
                    $lookup: {
                        from: 'routes',
                        localField: 'routeId',
                        foreignField: 'routeId',
                        as: 'route'
                    }
                },
                { $unwind: '$route' }
            ]);

            const BUFFER_MINUTES = 30;
            const [newH, newM] = body.departureTime.split(':').map(Number);
            const newStart = newH * 60 + newM;
            const newEnd = newStart + (route.estimatedDuration || 0) + BUFFER_MINUTES;

            for (const conflict of conflicts) {
                const [cH, cM] = conflict.departureTime.split(':').map(Number);
                const cStart = cH * 60 + cM;
                const cEnd = cStart + (conflict.route.estimatedDuration || 0) + BUFFER_MINUTES;

                // Check overlap
                if (newStart < cEnd && newEnd > cStart) {
                    if (conflict.driverId === body.driverId) {
                        return reply.status(409).send({ error: `Driver is already assigned to another schedule at this time (${conflict.departureTime})` });
                    }
                    if (conflict.vehicleId === body.vehicleId) {
                        return reply.status(409).send({ error: `Vehicle is already assigned to another schedule at this time (${conflict.departureTime})` });
                    }
                }
            }

            const schedule = await ScheduleModel.create({
                scheduleId: `SCHED-${randomUUID()}`,
                ...body,
                operatorId: body.operatorId || tenantId,
            });

            return reply.status(201).send({ success: true, data: schedule });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /schedules?routeId=X - List schedules
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const { tenantId } = req.user || {};
        const { routeId, vehicleId, operatorId } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = { isActive: true };
        if (tenantId) filter.operatorId = tenantId;
        else if (operatorId) filter.operatorId = operatorId;

        if (routeId) filter.routeId = routeId;
        if (vehicleId) filter.vehicleId = vehicleId;

        const [schedules, total] = await Promise.all([
            ScheduleModel.aggregate([
                { $match: filter },
                {
                    $lookup: {
                        from: 'routes', // Collection name
                        localField: 'routeId',
                        foreignField: 'routeId',
                        as: 'route'
                    }
                },
                { $unwind: { path: '$route', preserveNullAndEmptyArrays: true } },
                {
                    $lookup: {
                        from: 'vehicles',
                        localField: 'vehicleId',
                        foreignField: 'vehicleId',
                        as: 'vehicle'
                    }
                },
                { $unwind: { path: '$vehicle', preserveNullAndEmptyArrays: true } },
                {
                    $lookup: {
                        from: 'drivers',
                        localField: 'driverId',
                        foreignField: 'driverId',
                        as: 'driver'
                    }
                },
                { $unwind: { path: '$driver', preserveNullAndEmptyArrays: true } },
                { $sort: { departureTime: 1 } },
                { $skip: params.skip },
                { $limit: params.limit }
            ]),
            ScheduleModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(schedules, total, params));
    }

    /**
     * PATCH /schedules/:id - Update schedule
     */
    static async update(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const updates = req.body as any;

        const schedule = await ScheduleModel.findOneAndUpdate(
            { scheduleId: id },
            { $set: updates },
            { new: true }
        );

        if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

        return reply.send({ success: true, data: schedule });
    }

    /**
     * DELETE /schedules/:id - Cancel schedule
     */
    static async cancel(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { force } = req.query as { force?: string };

        const schedule = await ScheduleModel.findOne({ scheduleId: id });
        if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

        // 1. Identify active future trips
        const futureTrips = await TripModel.find({
            scheduleId: id,
            scheduledDepartureDate: { $gte: new Date() },
            status: { $ne: TripStatus.COMPLETED }
        });

        const tripIds = futureTrips.map(t => t.tripId);

        // 2. Check for active bookings if active trips exist
        if (tripIds.length > 0) {
            const activeBookingsCount = await BookingModel.countDocuments({
                tripId: { $in: tripIds },
                status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] }
            });

            if (activeBookingsCount > 0 && force !== 'true') {
                return reply.status(409).send({
                    error: `Cannot delete: ${activeBookingsCount} active booking(s) found for future trips.`,
                    requiresConfirmation: true,
                    activeBookingsCount
                });
            }
        }

        // 3. Proceed with cancellation
        schedule.isActive = false;
        await schedule.save();

        // Cascading soft delete: Cancel all FUTURE trips
        await TripModel.updateMany(
            {
                scheduleId: id,
                scheduledDepartureDate: { $gte: new Date() },
                status: { $ne: TripStatus.COMPLETED }
            },
            { status: TripStatus.CANCELLED }
        );

        // Optionally cancel bookings? (Or let Trip Status trigger it separately)
        // For now, we rely on Trip Cancellation.

        return reply.send({ success: true, message: 'Schedule and future trips deactivated' });
    }
}
