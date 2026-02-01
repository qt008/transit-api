import { FastifyRequest, FastifyReply } from 'fastify';
import { BookingService, CreateBookingInput } from '../services/booking.service';
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
    discount: z.number().optional()
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
            const input: CreateBookingInput = {
                userId,
                ...body,
                channel: BookingChannel.WEB, // Default, can be overridden for POS
                bookedBy: userId,
                bookedByRole: roles?.[0],
                tenantId,
                branchId: undefined // Branch ID not in token, optional for web booking
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
            } else if (tenantId) {
                // Get all tenant bookings (operator/admin view)
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
            const input: CreateBookingInput = {
                ...body,
                userId: body.passengerPhone, // Use phone as userId for walk-in customers
                channel: BookingChannel.POS,
                bookedBy: userId,
                bookedByRole: roles?.[0],
                tenantId,
                branchId: undefined // Branch ID not in token
            };

            const booking = await BookingService.createBooking(input);

            return reply.status(201).send({
                success: true,
                message: 'POS booking created successfully',
                data: booking
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }
}
