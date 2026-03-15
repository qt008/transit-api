import { FastifyRequest, FastifyReply } from 'fastify';
import { LedgerEntryModel } from '../../wallet/models/ledger-entry.model';
import { TripModel, TripStatus } from '../../fleet/models/trip.model';
import { VehicleModel } from '../../fleet/models/vehicle.model';
import { TicketModel } from '../../ticketing/models/ticket.model';
import { BookingModel, PaymentStatus } from '../../ticketing/models/booking.model';
import { SettlementModel } from '../../finance/models/settlement.model';
import { RouteModel } from '../../fleet/models/route.model';
import { cacheService } from '../../../shared/kernel/cache.service';

function escapeCSV(val: any): string {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function toCSV(headers: string[], rows: any[][]): string {
    return [headers, ...rows].map(row => row.map(escapeCSV).join(',')).join('\n');
}

// Platform-level roles see all tenants' data; operators see only their own
const PLATFORM_ROLES = new Set(['SUPER_ADMIN', 'GOVERNMENT']);

function getScopedTenantId(req: FastifyRequest): string | undefined {
    // @ts-ignore
    const { tenantId, role } = req.user || {};
    return PLATFORM_ROLES.has(role) ? undefined : tenantId;
}

export class AnalyticsController {

    /**
     * GET /analytics/revenue?startDate=X&endDate=Y&operatorId=Z
     * Revenue is derived from paid bookings (net of refunds).
     */
    static async getRevenue(req: FastifyRequest, reply: FastifyReply) {
        const { startDate, endDate, operatorId } = req.query as any;

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        // Ensure end date includes the full day (set to 23:59:59.999 UTC)
        if (endDate) {
            end.setUTCHours(23, 59, 59, 999);
        }

        const tenantId = getScopedTenantId(req);

        const filter: any = {
            paymentStatus: { $in: [PaymentStatus.PAID, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] },
            paidAt: {
                $gte: start,
                $lte: end
            }
        };

        if (tenantId) {
            filter.tenantId = tenantId;
        } else if (operatorId) {
            filter.tenantId = operatorId;
        }

        const netAmountExpr = {
            $subtract: [
                '$totalAmount',
                { $ifNull: ['$refundAmount', 0] }
            ]
        };

        const stats = await BookingModel.aggregate([
            { $match: filter },
            {
                $facet: {
                    // Total summary
                    summary: [
                        {
                            $group: {
                                _id: null,
                                totalRevenue: { $sum: { $multiply: [netAmountExpr, 0.01] } },
                                transactionCount: { $sum: 1 }
                            }
                        }
                    ],
                    // Daily breakdown for charts
                    breakdown: [
                        {
                            $group: {
                                _id: {
                                    $dateToString: { format: '%Y-%m-%d', date: '$paidAt' }
                                },
                                dailyRevenue: { $sum: { $multiply: [netAmountExpr, 0.01] } },
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
                    start: filter.paidAt.$gte,
                    end: filter.paidAt.$lte
                }
            }
        });
    }

    /**
     * GET /analytics/ridership?startDate=X&endDate=Y
     */
    static async getRidership(req: FastifyRequest, reply: FastifyReply) {
        const tenantId = getScopedTenantId(req);
        const { startDate, endDate, routeId } = req.query as any;

        const start = new Date(startDate || Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = new Date(endDate || Date.now());

        const bookingFilter: any = {
            paymentStatus: PaymentStatus.PAID,
            paidAt: { $gte: start, $lte: end }
        };
        if (tenantId) bookingFilter.tenantId = tenantId;
        if (routeId) bookingFilter.routeId = routeId;

        const tripFilter: any = {
            createdAt: { $gte: start, $lte: end }
        };
        if (tenantId) tripFilter.tenantId = tenantId;
        if (routeId) tripFilter.routeId = routeId;

        // Use paid bookings as the source of truth for passenger counts —
        // each booking = 1 passenger seat. TripModel.passengers is often unpopulated.
        const [totalPassengers, completedTrips] = await Promise.all([
            BookingModel.countDocuments(bookingFilter),
            TripModel.countDocuments({ ...tripFilter, status: TripStatus.COMPLETED }),
        ]);

        const avgPassengersPerTrip = completedTrips > 0
            ? Math.round((totalPassengers / completedTrips) * 10) / 10
            : 0;

        return reply.send({
            success: true,
            data: {
                totalTickets: totalPassengers, // bookings ≈ tickets in this system
                completedTrips,
                totalPassengers,
                avgPassengersPerTrip
            }
        });
    }

    /**
     * GET /analytics/fleet-utilization?operatorId=X
     */
    static async getFleetUtilization(req: FastifyRequest, reply: FastifyReply) {
        const { operatorId } = req.query as any;

        const cacheKey = `stakeholder:fleet:${operatorId || 'all'}`;

        try {
            const data = await cacheService.wrap(cacheKey, async () => {
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

                return { totalVehicles, activeVehicles, onTripVehicles, utilizationRate: `${utilizationRate}%` };
            }, 30); // 30-second TTL — this is a near-live metric

            return reply.send({ success: true, data });
        } catch (err: any) {
            return reply.status(500).send({ error: 'Failed to fetch fleet utilization' });
        }
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
     * GET /analytics/recent-activity?limit=10&type=BOOKING|TRIP&startDate=X&endDate=Y
     */
    static async getRecentActivity(req: FastifyRequest, reply: FastifyReply) {
        const tenantId = getScopedTenantId(req);
        const { limit = 5, type, startDate, endDate } = req.query as any;

        const queryLimit = Number(limit);
        const tenantFilter = tenantId ? { tenantId } : {};
        const dateFilter = (startDate && endDate)
            ? { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } }
            : {};
        const baseFilter = { ...tenantFilter, ...dateFilter };

        // Use cache only for the simple overview query (no type/date filters)
        const useCache = !type && !startDate && !endDate;
        const cacheKey = `stakeholder:activity:${tenantId || 'ALL'}:${queryLimit}`;

        try {
            const buildActivities = async () => {
                const fetchLimit = queryLimit * 2; // fetch extra to cover merged sort
                const [bookings, trips] = await Promise.all([
                    (!type || type === 'BOOKING')
                        ? BookingModel.find(baseFilter).sort({ createdAt: -1 }).limit(fetchLimit).lean()
                        : Promise.resolve([]),
                    (!type || type === 'TRIP')
                        ? TripModel.find(baseFilter).sort({ createdAt: -1 }).limit(fetchLimit).lean()
                        : Promise.resolve([])
                ]);

                // Batch-resolve route names and vehicle plates for trips
                const tripArr = trips as any[];
                const bookingArr = bookings as any[];

                const routeIdsToResolve = [
                    ...tripArr.map((t) => t.routeId),
                    ...bookingArr.filter((b) => !b.routeName).map((b) => b.routeId),
                ].filter(Boolean);

                const vehicleIds = tripArr.map((t) => t.vehicleId).filter(Boolean);

                const [routeDocs, vehicleDocs] = await Promise.all([
                    routeIdsToResolve.length
                        ? RouteModel.find({ routeId: { $in: routeIdsToResolve } }, { routeId: 1, name: 1 }).lean()
                        : Promise.resolve([]),
                    vehicleIds.length
                        ? VehicleModel.find({ vehicleId: { $in: vehicleIds } }, { vehicleId: 1, registrationNumber: 1, plateNumber: 1 }).lean()
                        : Promise.resolve([]),
                ]);

                const routeNameMap: Record<string, string> = {};
                for (const r of routeDocs as any[]) routeNameMap[r.routeId] = r.name;

                const vehiclePlateMap: Record<string, string> = {};
                for (const v of vehicleDocs as any[]) {
                    vehiclePlateMap[v.vehicleId] = v.registrationNumber || v.plateNumber || v.vehicleId;
                }

                const activities = [
                    ...bookingArr.map((b) => {
                        const route = b.routeName || routeNameMap[b.routeId] || b.routeId;
                        return {
                            id: b.bookingId,
                            type: 'BOOKING',
                            action: 'New Booking',
                            description: `${b.passengerName} booked seat ${b.seatNumber} on ${route}`,
                            time: b.createdAt,
                            metadata: { routeId: b.routeId, amount: (b.totalAmount || 0) / 100 }
                        };
                    }),
                    ...tripArr.map((t) => {
                        const route = routeNameMap[t.routeId] || t.routeId;
                        const bus = vehiclePlateMap[t.vehicleId] || t.vehicleId;
                        return {
                            id: t.tripId,
                            type: 'TRIP',
                            action: `Trip ${t.status}`,
                            description: `Route: ${route} • Bus: ${bus}`,
                            time: t.createdAt,
                            metadata: { status: t.status }
                        };
                    })
                ];

                return activities
                    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
                    .slice(0, queryLimit);
            };

            const sortedActivity = useCache
                ? await cacheService.wrap(cacheKey, buildActivities, 60)
                : await buildActivities();

            return reply.send({ success: true, data: sortedActivity });
        } catch (err: any) {
            console.error('Recent Activity Error:', err);
            return reply.status(500).send({ error: 'Failed to fetch activity' });
        }
    }

    /**
     * GET /analytics/route-profitability
     * Ranks routes by total margin / profit generated
     */
    static async getRouteProfitability(req: FastifyRequest, reply: FastifyReply) {
        const tenantId = getScopedTenantId(req);
        const { startDate, endDate } = req.query as any;

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        const dateKey = (d: Date) => d.toISOString().split('T')[0];
        const cacheKey = `stakeholder:routes:${tenantId || 'ALL'}:${dateKey(start)}:${dateKey(end)}`;

        try {
            const result = await cacheService.wrap(cacheKey, async () => {
                return TripModel.aggregate([
                    {
                        $match: {
                            ...(tenantId ? { tenantId } : {}),
                            status: TripStatus.COMPLETED,
                            createdAt: { $gte: start, $lte: end }
                        }
                    },
                    {
                        $group: {
                            _id: '$routeId',
                            revenue: { $sum: { $multiply: ['$revenue', 0.01] } },
                            trips: { $sum: 1 },
                            passengers: { $sum: '$passengers' }
                        }
                    },
                    { $sort: { revenue: -1 } },
                    { $limit: 10 },
                    {
                        $lookup: {
                            from: 'routes',
                            localField: '_id',
                            foreignField: 'routeId',
                            as: 'routeInfo'
                        }
                    },
                    {
                        $addFields: {
                            routeName: { $ifNull: [{ $arrayElemAt: ['$routeInfo.name', 0] }, '$_id'] }
                        }
                    },
                    {
                        $project: {
                            routeId: '$_id',
                            routeName: 1,
                            revenue: 1,
                            trips: 1,
                            passengers: 1,
                            avgLoadFactor: { $cond: [{ $eq: ['$trips', 0] }, 0, { $divide: ['$passengers', { $multiply: ['$trips', 40] }] }] },
                            _id: 0
                        }
                    }
                ]);
            }, 10 * 60); // 10-minute TTL

            return reply.send({ success: true, data: result });
        } catch (err: any) {
            return reply.status(500).send({ error: 'Failed to fetch route profitability' });
        }
    }

    /**
     * GET /analytics/geospatial-heatmaps?startDate=X&endDate=Y
     * Returns top departure stops ranked by booking volume
     */
    static async getGeospatialHeatmaps(req: FastifyRequest, reply: FastifyReply) {
        const tenantId = getScopedTenantId(req);
        const { startDate, endDate } = req.query as any;

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        const dateKey = (d: Date) => d.toISOString().split('T')[0];
        const cacheKey = `stakeholder:heatmap:${tenantId || 'ALL'}:${dateKey(start)}:${dateKey(end)}`;

        try {
            const data = await cacheService.wrap(cacheKey, async () => {
                const result = await BookingModel.aggregate([
                    {
                        $match: {
                            ...(tenantId ? { tenantId } : {}),
                            paymentStatus: PaymentStatus.PAID,
                            paidAt: { $gte: start, $lte: end }
                        }
                    },
                    {
                        $group: {
                            _id: '$fromStopName',
                            bookings: { $sum: 1 },
                            revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }
                        }
                    },
                    { $sort: { bookings: -1 } },
                    { $limit: 20 },
                    {
                        $project: {
                            name: '$_id',
                            bookings: 1,
                            revenue: { $round: ['$revenue', 2] },
                            // Normalise weight to 0–100 scale relative to the first (highest) result
                            weight: '$bookings',
                            _id: 0
                        }
                    }
                ]);

                // Normalise weight to a 0–100 scale
                const maxBookings = result[0]?.bookings || 1;
                return result.map((r: any) => ({
                    ...r,
                    weight: Math.round((r.bookings / maxBookings) * 100)
                }));
            }, 5 * 60); // 5-minute TTL

            return reply.send({ success: true, data });
        } catch (err: any) {
            console.error('Geospatial heatmap error:', err);
            return reply.status(500).send({ error: 'Failed to fetch booking density data' });
        }
    }

    /**
     * GET /analytics/stop-heatmap?startDate=X&endDate=Y
     * Returns stops with coordinates, booking counts, and route geometries for map rendering
     */
    static async getStopHeatmap(req: FastifyRequest, reply: FastifyReply) {
        const tenantId = getScopedTenantId(req);
        const { startDate, endDate } = req.query as any;

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        const tenantFilter = tenantId ? { tenantId } : {};
        const routeFilter = tenantId ? { operatorId: tenantId } : {};

        const dateKey = (d: Date) => d.toISOString().split('T')[0];
        const cacheKey = `stakeholder:stopheatmap:${tenantId || 'ALL'}:${startDate ? dateKey(start) : 'all'}:${endDate ? dateKey(end) : 'all'}`;

        try {
            const data = await cacheService.wrap(cacheKey, async () => {
                const dateMatchFilter = startDate && endDate
                    ? { paidAt: { $gte: start, $lte: end } }
                    : {};

                // Aggregate bookings by departure stop
                const bookingsByStop = await BookingModel.aggregate([
                    {
                        $match: {
                            ...tenantFilter,
                            paymentStatus: PaymentStatus.PAID,
                            ...dateMatchFilter
                        }
                    },
                    {
                        $group: {
                            _id: '$fromStopId',
                            name: { $first: '$fromStopName' },
                            bookings: { $sum: 1 },
                            revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }
                        }
                    },
                    { $sort: { bookings: -1 } },
                    { $limit: 100 }
                ]);

                // Build stop → coordinate lookup from route stops
                const routes = await RouteModel.find(
                    routeFilter,
                    { routeId: 1, name: 1, stops: 1, geometry: 1, isActive: 1 }
                ).lean();

                const stopCoords: Record<string, [number, number]> = {};
                for (const route of routes) {
                    for (const stop of route.stops || []) {
                        if (stop.stopId && stop.location?.coordinates?.length === 2) {
                            // Store as [lng, lat] (GeoJSON order)
                            stopCoords[stop.stopId] = stop.location.coordinates as [number, number];
                        }
                    }
                }

                const maxBookings = bookingsByStop[0]?.bookings || 1;

                // Stops with coordinates + normalised weight
                const stops = (bookingsByStop as any[])
                    .filter(s => stopCoords[s._id])
                    .map(s => ({
                        stopId: s._id,
                        name: s.name,
                        bookings: s.bookings,
                        revenue: Math.round(s.revenue * 100) / 100,
                        weight: Math.round((s.bookings / maxBookings) * 100),
                        // Leaflet wants [lat, lng]
                        lat: stopCoords[s._id][1],
                        lng: stopCoords[s._id][0],
                    }));

                // Route polylines — convert GeoJSON [lng,lat] to Leaflet [lat,lng]
                const routeLines = (routes as any[])
                    .filter(r => r.geometry?.coordinates?.length > 1)
                    .map(r => ({
                        routeId: r.routeId,
                        name: r.name,
                        isActive: r.isActive,
                        positions: r.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
                        stopCount: r.stops?.length || 0,
                    }));

                return { stops, routes: routeLines };
            }, 5 * 60); // 5-minute TTL

            return reply.send({ success: true, data });
        } catch (err: any) {
            console.error('Stop heatmap error:', err);
            return reply.status(500).send({ error: 'Failed to fetch stop heatmap data' });
        }
    }

    /**
     * POST /analytics/reports/generate
     * Generates and streams a CSV report for download
     */
    static async generateReport(req: FastifyRequest, reply: FastifyReply) {
        const { type = 'financial', startDate, endDate } = req.body as any;

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        end.setUTCHours(23, 59, 59, 999);

        const dateRange = `${start.toISOString().split('T')[0]}_to_${end.toISOString().split('T')[0]}`;

        let csv = '';
        let filename = '';

        try {
            if (type === 'financial') {
                const entries = await LedgerEntryModel.find({
                    createdAt: { $gte: start, $lte: end }
                }).lean();

                filename = `financial_statement_${dateRange}.csv`;
                const rows = (entries as any[]).map(e => [
                    e.entryId || e._id,
                    e.type,
                    (e.amount / 100).toFixed(2),
                    e.currency || 'GHS',
                    e.description || '',
                    e.metadata?.operatorId || '',
                    e.createdAt ? new Date(e.createdAt).toISOString() : ''
                ]);
                csv = toCSV(['Entry ID', 'Type', 'Amount (GHS)', 'Currency', 'Description', 'Operator ID', 'Date'], rows);

            } else if (type === 'settlement') {
                const settlements = await SettlementModel.find({
                    createdAt: { $gte: start, $lte: end }
                }).lean();

                filename = `settlement_ledger_${dateRange}.csv`;
                const rows = (settlements as any[]).map(s => [
                    s.settlementId,
                    s.operatorId,
                    s.status,
                    (s.totalFareCollected / 100).toFixed(2),
                    (s.totalPlatformFees / 100).toFixed(2),
                    (s.netPayableToOperator / 100).toFixed(2),
                    s.periodStart ? new Date(s.periodStart).toISOString().split('T')[0] : '',
                    s.periodEnd ? new Date(s.periodEnd).toISOString().split('T')[0] : '',
                    s.method || '',
                    s.createdAt ? new Date(s.createdAt).toISOString() : ''
                ]);
                csv = toCSV([
                    'Settlement ID', 'Operator ID', 'Status',
                    'Total Fare (GHS)', 'Platform Fees (GHS)', 'Net Payable (GHS)',
                    'Period Start', 'Period End', 'Method', 'Created At'
                ], rows);

            } else if (type === 'operational') {
                const trips = await TripModel.find({
                    createdAt: { $gte: start, $lte: end }
                }).lean();

                filename = `route_operational_report_${dateRange}.csv`;
                const rows = (trips as any[]).map(t => [
                    t.tripId,
                    t.routeId,
                    t.vehicleId,
                    t.driverId,
                    t.status,
                    t.passengers || 0,
                    ((t.revenue || 0) / 100).toFixed(2),
                    t.scheduledDepartureDate ? new Date(t.scheduledDepartureDate).toISOString().split('T')[0] : '',
                    t.scheduledDepartureTime || '',
                    t.actualDepartureTime ? new Date(t.actualDepartureTime).toISOString() : '',
                    t.actualArrivalTime ? new Date(t.actualArrivalTime).toISOString() : ''
                ]);
                csv = toCSV([
                    'Trip ID', 'Route ID', 'Vehicle ID', 'Driver ID', 'Status',
                    'Passengers', 'Revenue (GHS)', 'Date', 'Scheduled Time',
                    'Actual Departure', 'Actual Arrival'
                ], rows);
            } else {
                return reply.status(400).send({ error: `Unknown report type: ${type}` });
            }

            reply.header('Content-Type', 'text/csv');
            reply.header('Content-Disposition', `attachment; filename="${filename}"`);
            return reply.send(csv);

        } catch (err: any) {
            console.error('Report generation error:', err);
            return reply.status(500).send({ error: 'Failed to generate report' });
        }
    }
}
