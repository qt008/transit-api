import { FastifyRequest, FastifyReply } from 'fastify';
import { RouteModel } from '../models/route.model';
import { TripModel } from '../models/trip.model';
import { BranchModel } from '../models/branch.model';
import { BookingService, CreateBookingInput } from '../../ticketing/services/booking.service';
import { PricingService } from '../services/pricing.service';
import { BookingModel, BookingChannel, PaymentMethod, BookingStatus } from '../../ticketing/models/booking.model';
import { z } from 'zod';
import { VehicleModel } from '../models/vehicle.model';
import { AuthService } from '../../identity/services/auth.service';

// ─── Schemas ───
const SearchTripsSchema = z.object({
    date: z.string(),
    routeId: z.string().optional(),
    fromStopId: z.string().optional(),
    toStopId: z.string().optional(),
});

const CalculateFareSchema = z.object({
    routeId: z.string(),
    fromStopId: z.string(),
    toStopId: z.string(),
});

const PassengerSchema = z.object({
    seatNumber: z.string(),
    passengerName: z.string(),
    passengerPhone: z.string(),
    passengerEmail: z.string().email().optional(),
});

const CreateBookingRequestSchema = z.object({
    tripId: z.string(),
    routeId: z.string(),
    fromStopId: z.string(),
    toStopId: z.string(),
    passengers: z.array(PassengerSchema).min(1).max(10),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
});

import { env } from '../../../config/env';

// ... existing schemas

const InitiatePaymentSchema = z.object({
    paymentMethod: z.enum(['MOBILE_MONEY']),
    phoneNumber: z.string(),
    provider: z.string(),
});

export class WebPublicController {

    /**
     * GET /routes — List all active routes with branch names
     */
    static async listRoutes(_req: FastifyRequest, reply: FastifyReply) {
        try {
            const routes = await RouteModel.find({ isActive: true })
                .select('routeId name originBranchId destinationBranchId stops basePrice estimatedDuration operatorId')
                .lean();

            // Collect unique branch IDs
            const branchIds = new Set<string>();
            routes.forEach(r => {
                branchIds.add(r.originBranchId);
                branchIds.add(r.destinationBranchId);
                r.stops?.forEach(s => branchIds.add(s.branchId));
            });

            const branches = await BranchModel.find({ branchId: { $in: Array.from(branchIds) } })
                .select('branchId name city region')
                .lean();
            const branchMap = new Map(branches.map(b => [b.branchId, b]));

            const enriched = routes.map(route => ({
                ...route,
                originName: branchMap.get(route.originBranchId)?.name || route.originBranchId,
                originCity: branchMap.get(route.originBranchId)?.city || '',
                destinationName: branchMap.get(route.destinationBranchId)?.name || route.destinationBranchId,
                destinationCity: branchMap.get(route.destinationBranchId)?.city || '',
            }));

            return reply.send({ success: true, data: enriched });
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    }

    /**
     * GET /routes/popular — Top routes by booking count
     */
    static async popularRoutes(_req: FastifyRequest, reply: FastifyReply) {
        try {
            // Aggregate bookings to find most popular route IDs
            const popular = await BookingModel.aggregate([
                { $match: { status: { $ne: BookingStatus.CANCELLED } } },
                { $group: { _id: '$routeId', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 8 }
            ]);

            const routeIds = popular.map((p: any) => p._id);
            const routes = await RouteModel.find({ routeId: { $in: routeIds }, isActive: true })
                .select('routeId name originBranchId destinationBranchId basePrice estimatedDuration')
                .lean();

            const branchIds = new Set<string>();
            routes.forEach(r => {
                branchIds.add(r.originBranchId);
                branchIds.add(r.destinationBranchId);
            });

            const branches = await BranchModel.find({ branchId: { $in: Array.from(branchIds) } })
                .select('branchId name city')
                .lean();
            const branchMap = new Map(branches.map(b => [b.branchId, b]));

            // Preserve popularity order
            const orderedRoutes = routeIds.map(id => {
                const route = routes.find(r => r.routeId === id);
                if (!route) return null;
                const pop = popular.find((p: any) => p._id === id);
                return {
                    ...route,
                    bookingCount: pop?.count || 0,
                    originName: branchMap.get(route.originBranchId)?.name || '',
                    originCity: branchMap.get(route.originBranchId)?.city || '',
                    destinationName: branchMap.get(route.destinationBranchId)?.name || '',
                    destinationCity: branchMap.get(route.destinationBranchId)?.city || '',
                };
            }).filter(Boolean);

            // If not enough popular routes, fill with all active routes
            if (orderedRoutes.length < 4) {
                const allRoutes = await RouteModel.find({ isActive: true }).select('routeId name originBranchId destinationBranchId basePrice estimatedDuration').lean();
                const extraBranchIds = new Set<string>();
                allRoutes.forEach(r => {
                    extraBranchIds.add(r.originBranchId);
                    extraBranchIds.add(r.destinationBranchId);
                });
                const extraBranches = await BranchModel.find({ branchId: { $in: Array.from(extraBranchIds) } }).select('branchId name city').lean();
                const extraBranchMap = new Map(extraBranches.map(b => [b.branchId, b]));

                const existingIds = new Set(orderedRoutes.map((r: any) => r?.routeId));
                allRoutes.forEach(r => {
                    if (!existingIds.has(r.routeId) && orderedRoutes.length < 8) {
                        orderedRoutes.push({
                            ...r,
                            bookingCount: 0,
                            originName: extraBranchMap.get(r.originBranchId)?.name || '',
                            originCity: extraBranchMap.get(r.originBranchId)?.city || '',
                            destinationName: extraBranchMap.get(r.destinationBranchId)?.name || '',
                            destinationCity: extraBranchMap.get(r.destinationBranchId)?.city || '',
                        });
                    }
                });
            }

            return reply.send({ success: true, data: orderedRoutes });
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    }

    /**
     * GET /routes/:id — Route details with stops
     */
    static async getRoute(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        try {
            const route = await RouteModel.findOne({ routeId: id, isActive: true }).lean();
            if (!route) return reply.status(404).send({ error: 'Route not found' });

            const branchIds = [route.originBranchId, route.destinationBranchId, ...route.stops.map(s => s.branchId)];
            const branches = await BranchModel.find({ branchId: { $in: branchIds } }).select('branchId name city region').lean();
            const branchMap = new Map(branches.map(b => [b.branchId, b]));

            return reply.send({
                success: true,
                data: {
                    ...route,
                    originName: branchMap.get(route.originBranchId)?.name || '',
                    destinationName: branchMap.get(route.destinationBranchId)?.name || '',
                    stopsEnriched: route.stops.map(s => ({
                        ...s,
                        branchName: branchMap.get(s.branchId)?.name || s.name,
                    })),
                }
            });
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    }

    /**
     * GET /trips — Search trips by date & route
     */
    static async searchTrips(req: FastifyRequest, reply: FastifyReply) {
        const { date, routeId } = SearchTripsSchema.parse(req.query);
        try {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            const query: any = {
                scheduledDepartureDate: { $gte: startOfDay, $lte: endOfDay },
                status: { $in: ['SCHEDULED', 'DELAYED', 'BOARDING'] },
            };
            if (routeId) query.routeId = routeId;

            const trips = await TripModel.find(query)
                .select('tripId routeId scheduledDepartureDate scheduledDepartureTime status totalSeats availableSeats bookedSeats stops vehicleId operatorId')
                .sort({ scheduledDepartureTime: 1 })
                .lean();

            // Enrich with route + branch names
            const routeIds = [...new Set(trips.map(t => t.routeId))];
            const routes = await RouteModel.find({ routeId: { $in: routeIds } })
                .select('routeId name originBranchId destinationBranchId basePrice estimatedDuration')
                .lean();
            const routeMap = new Map(routes.map(r => [r.routeId, r]));

            const branchIds = new Set<string>();
            routes.forEach(r => {
                branchIds.add(r.originBranchId);
                branchIds.add(r.destinationBranchId);
            });
            const branches = await BranchModel.find({ branchId: { $in: Array.from(branchIds) } }).select('branchId name city').lean();
            const branchMap = new Map(branches.map(b => [b.branchId, b]));

            // Get vehicle info for seat layout
            const vehicleIds = [...new Set(trips.map(t => t.vehicleId))];
            const vehicles = await VehicleModel.find({ vehicleId: { $in: vehicleIds } })
                .select('vehicleId seatLayout make model plateNumber')
                .lean();
            const vehicleMap = new Map(vehicles.map(v => [v.vehicleId, v]));

            const enrichedTrips = trips.map(trip => {
                const route = routeMap.get(trip.routeId);
                const vehicle = vehicleMap.get(trip.vehicleId);
                return {
                    ...trip,
                    routeName: route?.name || trip.routeId,
                    originName: route ? branchMap.get(route.originBranchId)?.name || '' : '',
                    originCity: route ? branchMap.get(route.originBranchId)?.city || '' : '',
                    destinationName: route ? branchMap.get(route.destinationBranchId)?.name || '' : '',
                    destinationCity: route ? branchMap.get(route.destinationBranchId)?.city || '' : '',
                    basePrice: route?.basePrice || 0,
                    estimatedDuration: route?.estimatedDuration || 0,
                    vehicle: vehicle ? { make: vehicle.make, model: vehicle.model, plateNumber: vehicle.plateNumber, seatLayout: vehicle.seatLayout } : null,
                };
            });

            return reply.send({ success: true, data: enrichedTrips, count: enrichedTrips.length });
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    }

    /**
     * GET /trips/:id/availability — Seat availability for a trip
     */
    static async getTripAvailability(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        try {
            const trip = await TripModel.findOne({ tripId: id })
                .select('tripId routeId totalSeats availableSeats bookedSeats stops vehicleId scheduledDepartureDate scheduledDepartureTime status')
                .lean();
            if (!trip) return reply.status(404).send({ error: 'Trip not found' });

            const vehicle = await VehicleModel.findOne({ vehicleId: trip.vehicleId })
                .select('vehicleId seatLayout make model plateNumber')
                .lean();

            const route = await RouteModel.findOne({ routeId: trip.routeId })
                .select('routeId name originBranchId destinationBranchId stops')
                .lean();

            const branchIds = new Set<string>();
            if (route) {
                branchIds.add(route.originBranchId);
                branchIds.add(route.destinationBranchId);
                route.stops.forEach(s => branchIds.add(s.branchId));
            }
            const branches = await BranchModel.find({ branchId: { $in: Array.from(branchIds) } }).select('branchId name city').lean();
            const branchMap = new Map(branches.map(b => [b.branchId, b]));

            // Build stops list with branch names
            const allStops = [];
            if (route) {
                allStops.push({
                    stopId: route.originBranchId,
                    name: branchMap.get(route.originBranchId)?.name || 'Origin',
                    sequence: -1,
                });
                route.stops.forEach(s => {
                    allStops.push({
                        stopId: s.stopId,
                        name: branchMap.get(s.branchId)?.name || s.name,
                        sequence: s.sequence,
                    });
                });
                allStops.push({
                    stopId: route.destinationBranchId,
                    name: branchMap.get(route.destinationBranchId)?.name || 'Destination',
                    sequence: 9999,
                });
                allStops.sort((a, b) => a.sequence - b.sequence);
            }

            return reply.send({
                success: true,
                data: {
                    tripId: trip.tripId,
                    totalSeats: trip.totalSeats,
                    availableSeats: trip.availableSeats,
                    bookedSeats: trip.bookedSeats,
                    scheduledDepartureDate: trip.scheduledDepartureDate,
                    scheduledDepartureTime: trip.scheduledDepartureTime,
                    status: trip.status,
                    vehicle: vehicle ? {
                        make: vehicle.make,
                        model: vehicle.model,
                        plateNumber: vehicle.plateNumber,
                        seatLayout: vehicle.seatLayout,
                    } : null,
                    stops: allStops,
                }
            });
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    }

    /**
     * POST /fare/calculate — Calculate fare between stops
     */
    static async calculateFare(req: FastifyRequest, reply: FastifyReply) {
        const { routeId, fromStopId, toStopId } = CalculateFareSchema.parse(req.body);
        try {
            const fareInfo = await PricingService.calculateFare(routeId, fromStopId, toStopId);
            return reply.send({ success: true, data: fareInfo });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /bookings — Create a guest booking (multi-passenger)
     */
    static async createBooking(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateBookingRequestSchema.parse(req.body);
        try {
            // Get trip to find tenantId
            const trip = await TripModel.findOne({ tripId: body.tripId }).select('tenantId').lean();
            if (!trip) return reply.status(404).send({ error: 'Trip not found' });

            // Instantiate AuthService
            const authService = new AuthService();

            // 1. Resolve Booking Owner (Logged-in User OR Primary Guest)
            let ownerUserId: string;
            let bookedByRole = 'PASSENGER';

            try {
                // Optimistic Auth Check
                await req.jwtVerify();
            } catch (ignore) {
                // Not logged in or invalid token -> Treat as Guest
            }

            if (req.user) {
                // Logged-in User
                ownerUserId = req.user.id;
                // If the user has a specific role, we might want to capture it, but 'PASSENGER' is safe default for public bookings.
                // Or we can check req.user.role
                if (req.user.role) bookedByRole = req.user.role;
            } else {
                // Guest User - Resolve Single Owner for Batch
                // Prefer contact details, fallback to first passenger
                const primaryPhone = body.contactPhone || body.passengers[0].passengerPhone;
                const primaryName = (body.contactEmail ? body.contactEmail.split('@')[0] : '') || body.passengers[0].passengerName; // Best effort name if not provided

                // For guest we use the Trip's tenant as the user's tenant context usually/or Citizen tenant
                ownerUserId = await authService.getOrCreateGuestUser(
                    primaryPhone,
                    primaryName,
                    trip.tenantId
                );
            }

            const bookings = [];
            for (const passenger of body.passengers) {
                // Create booking under the Single Owner
                const input: CreateBookingInput = {
                    userId: ownerUserId, // Owner of the ticket
                    tripId: body.tripId,
                    routeId: body.routeId,
                    fromStopId: body.fromStopId,
                    toStopId: body.toStopId,
                    seatNumber: passenger.seatNumber,
                    passengerName: passenger.passengerName, // Actual Traveler
                    passengerPhone: passenger.passengerPhone,
                    passengerEmail: passenger.passengerEmail || body.contactEmail,
                    channel: BookingChannel.WEB,
                    bookedBy: ownerUserId,
                    bookedByRole: bookedByRole,
                    tenantId: trip.tenantId,
                };

                const booking = await BookingService.createBooking(input);
                bookings.push(booking);
            }

            // Generate a group reference for multi-passenger bookings
            const orderRef = bookings.length > 1
                ? `ORD-${bookings[0].bookingId.replace('BKG-', '')}`
                : bookings[0].bookingId;

            return reply.status(201).send({
                success: true,
                message: `${bookings.length} booking(s) created successfully`,
                data: {
                    orderId: orderRef,
                    bookings: bookings.map(b => ({
                        bookingId: b.bookingId,
                        passengerName: b.passengerName,
                        seatNumber: b.seatNumber,
                        totalAmount: b.totalAmount,
                        status: b.status,
                        paymentStatus: b.paymentStatus,
                    })),
                    totalAmount: bookings.reduce((sum, b) => sum + b.totalAmount, 0),
                },
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /bookings/:id — Lookup booking by bookingId
     */
    static async getBooking(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        try {
            const booking = await BookingModel.findOne({ bookingId: id }).lean();
            if (!booking) return reply.status(404).send({ error: 'Booking not found' });

            return reply.send({ success: true, data: booking });
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    }

    /**
     * POST /bookings/:id/pay — Initiate payment for a booking
     */
    static async initiatePayment(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const body = InitiatePaymentSchema.parse(req.body);
        try {

            if (body.paymentMethod === 'MOBILE_MONEY') {
                const result = await BookingService.initiateMobileMoneyPayment(id, body.phoneNumber, body.provider);

                // Update payment method on booking
                await BookingModel.updateOne(
                    { bookingId: id },
                    { paymentMethod: PaymentMethod.MOBILE_MONEY }
                );

                return reply.send({
                    success: true,
                    message: result.redirectUrl ? 'Redirecting to payment simulation...' : 'Payment prompt sent to phone',
                    data: result,
                });
            }
            return reply.status(400).send({ error: 'Unsupported payment method' });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /bookings/:id/retry-payment
     */
    static async retryPayment(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const body = InitiatePaymentSchema.parse(req.body);
        try {
            const result = await BookingService.initiateMobileMoneyPayment(id, body.phoneNumber, body.provider);
            return reply.send({
                success: true,
                message: result.paymentStatus === 'PAID' ? 'Payment successful' : 'Payment prompt resent',
                data: result
            });
        } catch (err: any) {
            console.log(err);
            return reply.status(400).send({ error: err.message });
        }
    }
}
