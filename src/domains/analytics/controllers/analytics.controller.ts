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

        const filter: any = {
            createdAt: {
                $gte: new Date(startDate || Date.now() - 30 * 24 * 60 * 60 * 1000),
                $lte: new Date(endDate || Date.now())
            }
        };

        if (operatorId) {
            filter['metadata.operatorId'] = operatorId;
        }

        const transactions = await LedgerEntryModel.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$amount' },
                    transactionCount: { $sum: 1 }
                }
            }
        ]);

        const result = transactions[0] || { totalRevenue: 0, transactionCount: 0 };

        return reply.send({
            success: true,
            data: {
                totalRevenue: result.totalRevenue,
                transactionCount: result.transactionCount,
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
                    totalRevenue: { $sum: '$revenue' },
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
}
