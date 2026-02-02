import { FastifyRequest, FastifyReply } from 'fastify';
import { LedgerEntryModel } from '../../wallet/models/ledger-entry.model';
import { TripModel, TripStatus } from '../../fleet/models/trip.model';
import { VehicleModel } from '../../fleet/models/vehicle.model';
import { TicketModel } from '../../ticketing/models/ticket.model';

export class AnalyticsController {

    /**
     * GET /analytics/revenue?startDate=X&endDate=Y&operatorId=Z
     */
    static async getRevenue(req: FastifyRequest, reply: FastifyReply) {
        const { startDate, endDate, operatorId } = req.query as any;

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        // Ensure end date includes the full day (set to 23:59:59.999 UTC)
        if (endDate) {
            end.setUTCHours(23, 59, 59, 999);
        }

        const filter: any = {
            createdAt: {
                $gte: start,
                $lte: end
            }
        };

        if (operatorId) {
            filter['metadata.operatorId'] = operatorId;
        }

        const stats = await LedgerEntryModel.aggregate([
            { $match: filter },
            {
                $facet: {
                    // Total summary
                    summary: [
                        {
                            $group: {
                                _id: null,
                                totalRevenue: { $sum: { $multiply: ['$amount', 0.01] } },
                                transactionCount: { $sum: 1 }
                            }
                        }
                    ],
                    // Daily breakdown for charts
                    breakdown: [
                        {
                            $group: {
                                _id: {
                                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                                },
                                dailyRevenue: { $sum: { $multiply: ['$amount', 0.01] } },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } } // Sort by date ascending
                    ]
                }
            }
        ]);

        const summary = stats[0].summary[0] || { totalRevenue: 0, transactionCount: 0 };
        const breakdown = stats[0].breakdown || [];

        return reply.send({
            success: true,
            data: {
                totalRevenue: summary.totalRevenue,
                transactionCount: summary.transactionCount,
                breakdown: breakdown.map((b: any) => ({
                    date: b._id,
                    revenue: b.dailyRevenue,
                    count: b.count
                })),
                period: {
                    start: filter.createdAt.$gte,
                    end: filter.createdAt.$lte
                }
            }
        });
    }

    /**
     * GET /analytics/ridership?startDate=X&endDate=Y
     */
    static async getRidership(req: FastifyRequest, reply: FastifyReply) {
        const { startDate, endDate, routeId } = req.query as any;

        const filter: any = {
            createdAt: {
                $gte: new Date(startDate || Date.now() - 30 * 24 * 60 * 60 * 1000),
                $lte: new Date(endDate || Date.now())
            }
        };

        if (routeId) filter.routeId = routeId;

        const [totalTickets, completedTrips, activePassengers] = await Promise.all([
            TicketModel.countDocuments(filter),
            TripModel.countDocuments({
                ...filter,
                status: TripStatus.COMPLETED
            }),
            TripModel.aggregate([
                { $match: { ...filter, status: TripStatus.COMPLETED } },
                {
                    $group: {
                        _id: null,
                        totalPassengers: { $sum: '$passengers' },
                        avgPassengersPerTrip: { $avg: '$passengers' }
                    }
                }
            ])
        ]);

        const passengerStats = activePassengers[0] || {
            totalPassengers: 0,
            avgPassengersPerTrip: 0
        };

        return reply.send({
            success: true,
            data: {
                totalTickets,
                completedTrips,
                totalPassengers: passengerStats.totalPassengers,
                avgPassengersPerTrip: passengerStats.avgPassengersPerTrip
            }
        });
    }

    /**
     * GET /analytics/fleet-utilization?operatorId=X
     */
    static async getFleetUtilization(req: FastifyRequest, reply: FastifyReply) {
        const { operatorId } = req.query as any;

        const filter: any = {};
        if (operatorId) filter.operatorId = operatorId;

        const [totalVehicles, activeVehicles, onTripVehicles] = await Promise.all([
            VehicleModel.countDocuments(filter),
            VehicleModel.countDocuments({ ...filter, status: 'ACTIVE' }),
            VehicleModel.countDocuments({ ...filter, status: 'ON_TRIP' })
        ]);

        const utilizationRate = totalVehicles > 0
            ? ((onTripVehicles / totalVehicles) * 100).toFixed(2)
            : '0.00';

        return reply.send({
            success: true,
            data: {
                totalVehicles,
                activeVehicles,
                onTripVehicles,
                utilizationRate: `${utilizationRate}%`
            }
        });
    }

    /**
     * GET /analytics/driver-performance?driverId=X
     */
    static async getDriverPerformance(req: FastifyRequest, reply: FastifyReply) {
        const { driverId } = req.query as any;

        if (!driverId) {
            return reply.status(400).send({ error: 'driverId required' });
        }

        const stats = await TripModel.aggregate([
            { $match: { driverId, status: TripStatus.COMPLETED } },
            {
                $group: {
                    _id: '$driverId',
                    totalTrips: { $sum: 1 },
                    totalRevenue: { $sum: { $multiply: ['$revenue', 0.01] } },
                    totalPassengers: { $sum: '$passengers' },
                    avgPassengers: { $avg: '$passengers' }
                }
            }
        ]);

        const result = stats[0] || {
            totalTrips: 0,
            totalRevenue: 0,
            totalPassengers: 0,
            avgPassengers: 0
        };

        return reply.send({
            success: true,
            data: result
        });
    }
    /**
     * GET /analytics/recent-activity?limit=10
     */
    static async getRecentActivity(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const { tenantId } = req.user || {};
        const { limit = 5 } = req.query as any;

        try {
            const queryLimit = Number(limit);

            // 1. Fetch recent bookings
            // We need to import BookingModel. Lazy import or assume it's available?
            // Better to import it at the top. But since I can't easily add top imports in this block, 
            // I'll use lazy import for this specific controller method modification pattern 
            // OR I'll use the existing imports if I can see them.
            // I see TripModel is imported. BookingModel is NOT imported in the file view I saw earlier.
            // So I will use lazy import.
            const { BookingModel } = await import('../../ticketing/models/booking.model');

            const recentBookings = await BookingModel.find(tenantId ? { tenantId } : {})
                .sort({ createdAt: -1 })
                .limit(queryLimit)
                .populate('tripId', 'routeId') // Get route info
                .lean();

            // 2. Fetch recent trips (Created or Completed)
            const recentTrips = await TripModel.find(tenantId ? { tenantId } : {})
                .sort({ createdAt: -1 })
                .limit(queryLimit)
                .lean();

            // 3. Normalize and Merge
            const activities = [
                ...recentBookings.map((b: any) => ({
                    id: b.bookingId,
                    type: 'BOOKING',
                    action: 'New Booking',
                    description: `${b.passengerName} booked seat ${b.seatNumber}`,
                    time: b.createdAt,
                    metadata: { routeId: b.tripId?.routeId, amount: (b.totalAmount || 0) / 100 }
                })),
                ...recentTrips.map((t: any) => ({
                    id: t.tripId,
                    type: 'TRIP',
                    action: `Trip ${t.status}`, // e.g., Trip SCHEDULED, Trip COMPLETED
                    description: `Route: ${t.routeId} • Bus: ${t.vehicleId}`,
                    time: t.createdAt, // Or updatedAt for status changes? sticking to createdAt for simplicity of "New things"
                    metadata: { status: t.status }
                }))
            ];

            // 4. Sort combined list and slice
            const sortedActivity = activities
                .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
                .slice(0, queryLimit);

            return reply.send({
                success: true,
                data: sortedActivity
            });
        } catch (err: any) {
            console.error('Recent Activity Error:', err);
            return reply.status(500).send({ error: 'Failed to fetch activity' });
        }
    }
}
