import { TripModel, ITrip, TripStatus } from '../models/trip.model';
import { ScheduleModel } from '../models/schedule.model';
import { RouteModel } from '../models/route.model';
import { VehicleModel } from '../models/vehicle.model';
import { v4 as uuidv4 } from 'uuid';
import mongoose, { ClientSession } from 'mongoose';

export class TripService {
    /**
     * Generate trips from a schedule for a date range
     */
    static async generateTripsFromSchedule(
        scheduleId: string,
        startDate: Date,
        endDate: Date,
        createdBy: string
    ): Promise<ITrip[]> {
        const schedule = await ScheduleModel.findOne({ scheduleId });
        if (!schedule) throw new Error('Schedule not found');

        const route = await RouteModel.findOne({ routeId: schedule.routeId });
        if (!route) throw new Error('Route not found');

        const vehicle = await VehicleModel.findOne({ vehicleId: schedule.vehicleId });
        if (!vehicle) throw new Error('Vehicle not found');

        const trips: ITrip[] = [];
        const currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            const dayOfWeek = currentDate.getDay();

            // Check if schedule runs on this day
            if (schedule.daysOfWeek.includes(dayOfWeek)) {
                // Check if this specific date already has a trip
                const existingTrip = await TripModel.findOne({
                    scheduleId,
                    scheduledDepartureDate: {
                        $gte: new Date(currentDate.setHours(0, 0, 0, 0)),
                        $lt: new Date(currentDate.setHours(23, 59, 59, 999))
                    }
                });

                if (!existingTrip) {
                    const trip = await TripModel.create({
                        tripId: `TRIP-${uuidv4()}`,
                        scheduleId,
                        routeId: schedule.routeId,
                        vehicleId: schedule.vehicleId,
                        driverId: schedule.driverId,
                        branchId: route.originBranchId,
                        operatorId: schedule.operatorId,
                        tenantId: vehicle.tenantId || '',

                        scheduledDepartureDate: new Date(currentDate),
                        scheduledDepartureTime: schedule.departureTime,

                        status: TripStatus.SCHEDULED,
                        currentStopIndex: 0,

                        totalSeats: vehicle.capacity || 40,
                        availableSeats: vehicle.capacity || 40,
                        bookedSeats: [],

                        stops: route.stops,

                        passengers: 0,
                        revenue: 0,

                        createdBy
                    });

                    trips.push(trip);
                }
            }

            currentDate.setDate(currentDate.getDate() + 1);
        }

        return trips;
    }

    /**
     * Get available seats for a trip
     */
    static async getAvailableSeats(tripId: string): Promise<string[]> {
        const trip = await TripModel.findOne({ tripId });
        if (!trip) throw new Error('Trip not found');

        const vehicle = await VehicleModel.findOne({ vehicleId: trip.vehicleId });
        if (!vehicle) throw new Error('Vehicle not found');

        // Generate all seat numbers (assuming simple numbering 1-N)
        const allSeats: string[] = [];
        for (let i = 1; i <= trip.totalSeats; i++) {
            allSeats.push(String(i));
        }

        // Filter out booked seats
        return allSeats.filter(seat => !trip.bookedSeats.includes(seat));
    }

    /**
     * Book a seat on a trip (atomic operation)
     */
    static async bookSeat(tripId: string, seatNumber: string, session?: ClientSession): Promise<boolean> {
        const result = await TripModel.updateOne(
            {
                tripId,
                availableSeats: { $gt: 0 },
                bookedSeats: { $ne: seatNumber } // Seat not already booked
            },
            {
                $inc: { availableSeats: -1, passengers: 1 },
                $push: { bookedSeats: seatNumber }
            },
            { session }
        );

        return result.modifiedCount > 0;
    }

    /**
     * Release a seat (for cancellations)
     */
    static async releaseSeat(tripId: string, seatNumber: string, session?: ClientSession): Promise<boolean> {
        const result = await TripModel.updateOne(
            {
                tripId,
                bookedSeats: seatNumber
            },
            {
                $inc: { availableSeats: 1, passengers: -1 },
                $pull: { bookedSeats: seatNumber }
            },
            { session }
        );

        return result.modifiedCount > 0;
    }

    /**
     * Update trip revenue
     */
    static async addRevenue(tripId: string, amount: number, session?: ClientSession): Promise<void> {
        await TripModel.updateOne(
            { tripId },
            { $inc: { revenue: amount } },
            { session }
        );
    }

    /**
     * Get trips by filters
     */
    static async getTrips(filters: {
        routeId?: string;
        branchId?: string;
        vehicleId?: string;
        driverId?: string;
        startDate?: Date;
        endDate?: Date;
        status?: TripStatus;
    }): Promise<ITrip[]> {
        const query: any = {};

        if (filters.routeId) query.routeId = filters.routeId;
        if (filters.branchId) query.branchId = filters.branchId;
        if (filters.vehicleId) query.vehicleId = filters.vehicleId;
        if (filters.driverId) query.driverId = filters.driverId;
        if (filters.status) query.status = filters.status;

        if (filters.startDate || filters.endDate) {
            query.scheduledDepartureDate = {};
            if (filters.startDate) {
                query.scheduledDepartureDate.$gte = filters.startDate;
            }
            if (filters.endDate) {
                query.scheduledDepartureDate.$lte = filters.endDate;
            }
        } else if (!filters.startDate && !filters.endDate && filters.status !== TripStatus.COMPLETED) {
            // Default: Only show future trips or trips from today onwards
            // Unless specifically asking for COMPLETED or providing a date range
            query.scheduledDepartureDate = { $gte: new Date(new Date().setHours(0, 0, 0, 0)) };
        }

        const trips = await TripModel.aggregate([
            { $match: query },
            {
                $lookup: {
                    from: 'routes',
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
            { $sort: { scheduledDepartureDate: 1, scheduledDepartureTime: 1 } }
        ]);

        // Filter out past trips (Time-based check for Today)
        // If status is specific (e.g. searching for COMPLETED), skip this.
        // If status is not provided or is SCHEDULED/IN_PROGRESS/DELAYED, we might want to filter?
        // Actually, user request: "on clicking the POS booking, no trips should even be populated if they do not match teh availability criteria"
        // This implies availability search.
        // If we are just listing trips for Admin (e.g. Schedule Page), we might want to see them all?
        // But this function is general.
        // Let's assume if status is NOT 'COMPLETED' and NOT 'CANCELLED', and we are looking at today, we filter time.

        if (filters.status !== TripStatus.COMPLETED && filters.status !== TripStatus.CANCELLED) {
            const now = new Date();
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            return trips.filter(trip => {
                const tripDate = new Date(trip.scheduledDepartureDate);
                // If trip is in the past (before today), filter out (though query usually handles this if default)
                if (tripDate < todayStart) return false;

                // If trip is strictly in future (> today), keep
                if (tripDate > todayStart) return true;

                // If trip is TODAY, check time
                if (tripDate.getTime() === todayStart.getTime()) {
                    const [hours, minutes] = (trip.scheduledDepartureTime || '00:00').split(':').map(Number);
                    const tripTime = new Date(tripDate);
                    tripTime.setHours(hours, minutes, 0, 0);

                    // Allow seeing trip if it is within last 15 mins? No, strict "if time is past".
                    // Maybe give 5 mins grace for "just missed"? User said "if trip time is past... no trips".
                    return tripTime > now;
                }

                return true; // Should not reach here if logic covers < > =
            });
        }

        return trips;
    }

    /**
     * Get trip availability details
     */
    static async getTripAvailability(tripId: string): Promise<{
        trip: ITrip;
        availableSeats: string[];
        bookedSeatsCount: number;
        occupancyRate: number;
    }> {
        const trip = await TripModel.findOne({ tripId });
        if (!trip) throw new Error('Trip not found');

        const available = await this.getAvailableSeats(tripId);
        const occupancyRate = (trip.bookedSeats.length / trip.totalSeats) * 100;

        return {
            trip,
            availableSeats: available,
            bookedSeatsCount: trip.bookedSeats.length,
            occupancyRate
        };
    }

    /**
     * Update trip status
     */
    static async updateTripStatus(tripId: string, status: TripStatus): Promise<ITrip> {
        const trip = await TripModel.findOneAndUpdate(
            { tripId },
            { $set: { status } },
            { new: true }
        );

        if (!trip) throw new Error('Trip not found');
        return trip;
    }

    /**
     * Start a trip (driver action)
     */
    static async startTrip(tripId: string): Promise<ITrip> {
        const trip = await TripModel.findOneAndUpdate(
            { tripId, status: TripStatus.SCHEDULED },
            {
                $set: {
                    status: TripStatus.IN_PROGRESS,
                    actualDepartureTime: new Date()
                }
            },
            { new: true }
        );

        if (!trip) {
            throw new Error('Trip not found or already started');
        }

        return trip;
    }

    /**
     * Complete a trip
     */
    static async completeTrip(tripId: string): Promise<ITrip> {
        const trip = await TripModel.findOneAndUpdate(
            { tripId, status: TripStatus.IN_PROGRESS },
            {
                $set: {
                    status: TripStatus.COMPLETED,
                    actualArrivalTime: new Date()
                }
            },
            { new: true }
        );

        if (!trip) {
            throw new Error('Trip not found or not in progress');
        }

        return trip;
    }
}
