import { FastifyRequest, FastifyReply } from 'fastify';
import { BookingService, CreateBookingInput } from '../services/booking.service';
import { AuthService } from '../../identity/services/auth.service';
import { BookingStatus, PaymentMethod, BookingChannel } from '../models/booking.model';
import { z } from 'zod';

const CreateBookingSchema = z.object({
    tripId: z.string(),
    routeId: z.string(),
    fromStopId: z.string(),
    toStopId: z.string(),
    seatNumber: z.string(),
    passengerName: z.string(),
    passengerPhone: z.string(),
    passengerEmail: z.string().email().optional(),
    passengerIdNumber: z.string().optional(),
    discount: z.number().optional(),
    paymentMethod: z.enum(['CASH', 'CARD', 'MOBILE_MONEY']).optional(), // New field for POS choice
    paymentReference: z.string().nullable().optional() // Make optional/nullable for Cash
});

const ProcessPaymentSchema = z.object({
    paymentMethod: z.nativeEnum(PaymentMethod),
    paymentReference: z.string().optional()
});

const CancelBookingSchema = z.object({
    reason: z.string().optional()
});

export class BookingController {
    /**
     * POST /bookings - Create a booking
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateBookingSchema.parse(req.body);
        // @ts-ignore
        const { id: userId, tenantId, role } = req.user || {};
        const roles = role ? [role] : [];

        try {
            // Unified User Resolution
            let finalUserId = userId; // From token if logged in

            // If not logged in (Guest), resolve user via phone
            if (!finalUserId) {
                const authService = new AuthService(); // Instantiate service
                // Use a default tenant for public web guests if tenantId is missing?
                // Usually tenantId comes from subdomain/header. If undefined, we might have an issue.
                // Assuming tenantId is extracted from request header in middleware even for public routes?
                // If not, we might default to a 'ROOT' or specific tenant.
                // For now, let's assume valid tenantId or throw.
                if (!tenantId) {
                    // Try to get from header directly if middleware didn't attach to user object (since no user)
                    // @ts-ignore
                    const headerTenant = req.headers['x-tenant-id'] as string;
                    if (!headerTenant) throw new Error('Tenant ID required');
                    // Re-assign for use
                    // tenantId is const in outer scope? No, it's from destructuring.
                }

                const targetTenant = tenantId || (req.headers['x-tenant-id'] as string);

                finalUserId = await authService.getOrCreateGuestUser(
                    body.passengerPhone,
                    body.passengerName,
                    targetTenant
                );
            }

            const input: CreateBookingInput = {
                userId: finalUserId,
                ...body,
                channel: BookingChannel.WEB,
                bookedBy: finalUserId, // Guest books for themselves
                bookedByRole: roles?.[0] || 'PASSENGER',
                tenantId: tenantId || (req.headers['x-tenant-id'] as string),
                branchId: undefined
            };

            const booking = await BookingService.createBooking(input);

            return reply.status(201).send({
                success: true,
                message: 'Booking created successfully',
                data: booking
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /bookings - Get user bookings (or all for operators)
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const { id: userId, tenantId, role } = req.user || {};
        const { status, startDate, endDate, tripId } = req.query as any;

        try {
            let bookings;

            if (tripId) {
                // Get bookings for a specific trip (operator view)
                bookings = await BookingService.getTripBookings(tripId);
            } else if (tenantId && role !== 'PASSENGER' && role !== 'GUEST') {
                // Get all tenant bookings (operator/admin view)
                // Exclude PASSENGER/GUEST from this check so they fall through to getUserBookings
                bookings = await BookingService.getTenantBookings(tenantId, {
                    status: status as BookingStatus,
                    startDate: startDate ? new Date(startDate) : undefined,
                    endDate: endDate ? new Date(endDate) : undefined
                });
            } else {
                // Get user's own bookings
                bookings = await BookingService.getUserBookings(userId, {
                    status: status as BookingStatus,
                    startDate: startDate ? new Date(startDate) : undefined,
                    endDate: endDate ? new Date(endDate) : undefined
                });
            }

            return reply.send({
                success: true,
                data: bookings,
                count: bookings.length
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /bookings/:id - Get booking details
     */
    static async getById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        try {
            const booking = await BookingService.getBookingById(id);

            if (!booking) {
                return reply.status(404).send({ error: 'Booking not found' });
            }

            return reply.send({ success: true, data: booking });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /bookings/:id/pay - Process payment
     */
    static async processPayment(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const body = ProcessPaymentSchema.parse(req.body);

        try {
            const result = await BookingService.processPayment(
                id,
                body.paymentMethod,
                body.paymentReference
            );

            return reply.send({
                success: true,
                message: 'Payment processed successfully',
                data: result
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /bookings/:id/cancel - Cancel booking
     */
    static async cancel(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const body = CancelBookingSchema.parse(req.body);
        // @ts-ignore
        const { userId } = req.user || {};

        try {
            const booking = await BookingService.cancelBooking(
                id,
                userId,
                body.reason
            );

            return reply.send({
                success: true,
                message: 'Booking cancelled successfully',
                data: booking
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /bookings/:id/check-in - Check in booking
     */
    static async checkIn(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        // @ts-ignore
        const { userId } = req.user || {};

        try {
            const booking = await BookingService.checkInBooking(id, userId);

            return reply.send({
                success: true,
                message: 'Checked in successfully',
                data: booking
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /pos/bookings - Operator creates booking (POS)
     */
    static async createPOSBooking(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateBookingSchema.parse(req.body);
        // @ts-ignore
        const { id: userId, tenantId, role } = req.user || {};
        const roles = role ? [role] : [];

        try {
            // Resolve User for POS (Walk-in)
            const authService = new AuthService();
            const passengerUserId = await authService.getOrCreateGuestUser(
                body.passengerPhone,
                body.passengerName,
                tenantId
            );

            const input: CreateBookingInput = {
                ...body,
                userId: passengerUserId, // Use the resolved persistent User ID
                channel: BookingChannel.POS,
                bookedBy: userId, // Operator ID
                bookedByRole: roles?.[0],
                tenantId,
                branchId: undefined
            };

            const booking = await BookingService.createBooking(input);

            if (body.paymentMethod === PaymentMethod.MOBILE_MONEY) {
                const provider = body.paymentReference || 'MTN_MOMO_GHA';
                const phone = body.passengerPhone;

                try {
                    const result = await BookingService.initiateMobileMoneyPayment(booking.bookingId, phone, provider);

                    // We need to ensure the booking object has the method set
                    booking.paymentMethod = PaymentMethod.MOBILE_MONEY;
                    await booking.save();

                    return reply.status(201).send({
                        success: true,
                        message: 'Payment prompt sent to user phone',
                        data: booking,
                        paymentStatus: 'PENDING_AUTHORIZATION'
                    });
                } catch (payErr: any) {
                    console.error('Payment initiation failed:', payErr);
                    return reply.status(201).send({
                        success: true,
                        message: 'Booking created but payment failed: ' + payErr.message,
                        data: booking,
                        paymentStatus: 'FAILED'
                    });
                }
            }

            // Auto-process CASH payment for POS bookings
            const { booking: paidBooking } = await BookingService.processPayment(
                booking.bookingId,
                PaymentMethod.CASH,
                `POS-${booking.bookingId}`
            );

            return reply.status(201).send({
                success: true,
                message: 'POS booking created successfully',
                data: paidBooking
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /bookings/:id/retry-payment - Retry Mobile Money Payment
     */
    static async retryPayment(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const body = ProcessPaymentSchema.parse(req.body); // Reuse ProcessPaymentSchema if it has method/ref

        // Schema validation note: ProcessPaymentSchema requires paymentMethod.
        // If the user sends "MOBILE_MONEY" and "paymentReference" (provider), we can reuse it.

        try {
            if (body.paymentMethod === PaymentMethod.MOBILE_MONEY) {
                // If retrying, we might need the phone number again.
                // If checking out existing booking, we use passengerPhone?
                // Or does the schema support passing a phone number?
                // ProcessPaymentSchema currently only has method and ref.
                // We might need to fetch the booking to get the phone number if not provided.

                const booking = await BookingService.getBookingById(id);
                if (!booking) return reply.status(404).send({ error: 'Booking not found' });

                const provider = body.paymentReference || 'MTN_MOMO_GHA';
                // Use existing passenger phone
                const phone = booking.passengerPhone;

                const result = await BookingService.initiateMobileMoneyPayment(id, phone, provider);

                return reply.send({
                    success: true,
                    message: 'Payment prompt resent',
                    data: result
                });
            }

            // If retrying with CASH, just mark as paid?
            if (body.paymentMethod === PaymentMethod.CASH) {
                const result = await BookingService.processPayment(
                    id,
                    PaymentMethod.CASH,
                    `RETRY-${id}`
                );
                return reply.send({
                    success: true,
                    message: 'Payment processed (Cash)',
                    data: result
                });
            }

            return reply.status(400).send({ error: 'Unsupported payment method for retry' });

        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }
}
