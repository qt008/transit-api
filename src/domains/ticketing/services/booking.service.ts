import { BookingModel, IBooking, BookingStatus, PaymentStatus, PaymentMethod, BookingChannel } from '../models/booking.model';
import { TripService } from '../../fleet/services/trip.service';
import { PricingService } from '../../fleet/services/pricing.service';
import { TripModel } from '../../fleet/models/trip.model';
import { BranchModel } from '../../fleet/models/branch.model';
import { TicketModel, TicketStatus } from '../models/ticket.model';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

function generateBookingId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = 'BKG-';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export interface CreateBookingInput {
    userId: string;
    tripId: string;
    routeId: string;
    fromStopId: string;
    toStopId: string;
    seatNumber: string;
    passengerName: string;
    passengerPhone: string;
    passengerEmail?: string;
    passengerIdNumber?: string;
    channel: BookingChannel;
    bookedBy: string;
    bookedByRole?: string;
    tenantId: string;
    branchId?: string;
    discount?: number;
}

export class BookingService {
    /**
     * Create a new booking
     */
    static async createBooking(input: CreateBookingInput): Promise<IBooking> {
        // 1. Verify trip exists and get details
        const trip = await TripModel.findOne({ tripId: input.tripId });
        if (!trip) throw new Error('Trip not found');

        // 2. Check if seat is available
        const seatBooked = await TripService.bookSeat(input.tripId, input.seatNumber);
        if (!seatBooked) {
            throw new Error('Seat not available or already booked');
        }

        try {
            // 3. Calculate fare
            const fareInfo = await PricingService.calculateFare(
                input.routeId,
                input.fromStopId,
                input.toStopId
            );

            const baseFare = fareInfo.price;
            const discount = input.discount || 0;
            const taxAmount = Math.round(baseFare * 0.05); // 5% tax
            const totalAmount = baseFare - discount + taxAmount;

            // 4. Get stop names
            // 4. Get stop/branch names
            let fromStopName = trip.stops.find(s => s.stopId === input.fromStopId)?.name;
            let toStopName = trip.stops.find(s => s.stopId === input.toStopId)?.name;

            // If not found in stops, check if they are branches (Direct Trip)
            if (!fromStopName) {
                const fromBranch = await BranchModel.findOne({ branchId: input.fromStopId });
                if (fromBranch) fromStopName = fromBranch.name;
            }

            if (!toStopName) {
                const toBranch = await BranchModel.findOne({ branchId: input.toStopId });
                if (toBranch) toStopName = toBranch.name;
            }

            if (!fromStopName || !toStopName) {
                throw new Error('Invalid stop or branch selection');
            }

            // 5. Create booking
            const booking = await BookingModel.create({
                bookingId: generateBookingId(),
                userId: input.userId,
                tripId: input.tripId,

                routeId: input.routeId,
                fromStopId: input.fromStopId,
                fromStopName: fromStopName,
                toStopId: input.toStopId,
                toStopName: toStopName,

                scheduledDepartureDate: trip.scheduledDepartureDate,
                scheduledDepartureTime: trip.scheduledDepartureTime,

                passengerName: input.passengerName,
                passengerPhone: input.passengerPhone,
                passengerEmail: input.passengerEmail,
                passengerIdNumber: input.passengerIdNumber,

                seatNumber: input.seatNumber,

                baseFare,
                discount,
                taxAmount,
                totalAmount,

                paymentStatus: PaymentStatus.PENDING,

                bookedBy: input.bookedBy,
                bookedByRole: input.bookedByRole,
                bookingChannel: input.channel,

                status: BookingStatus.PENDING,

                tenantId: input.tenantId,
                branchId: input.branchId
            });

            return booking;
        } catch (error) {
            // Rollback seat reservation if booking creation fails
            await TripService.releaseSeat(input.tripId, input.seatNumber);
            throw error;
        }
    }

    /**
     * Process payment for a booking
     */
    static async processPayment(
        bookingId: string,
        paymentMethod: PaymentMethod,
        paymentReference?: string
    ): Promise<{ booking: IBooking; ticket?: any }> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');

        if (booking.paymentStatus === PaymentStatus.PAID) {
            throw new Error('Booking already paid');
        }

        // Update booking payment status
        booking.paymentStatus = PaymentStatus.PAID;
        booking.paymentMethod = paymentMethod;
        booking.paymentReference = paymentReference || `PAY-${uuidv4()}`;
        booking.paidAt = new Date();
        booking.status = BookingStatus.CONFIRMED;
        await booking.save();

        // Update trip revenue
        await TripService.addRevenue(booking.tripId, booking.totalAmount);

        // Generate ticket
        const ticket = await this.generateTicket(booking);

        // Link ticket to booking
        booking.ticketId = ticket.ticketId;
        await booking.save();

        return { booking, ticket };
    }

    /**
     * Generate ticket after payment
     */
    private static async generateTicket(booking: IBooking): Promise<any> {
        const secret = crypto.randomBytes(32).toString('hex');
        const qrData = `${booking.bookingId}:${booking.tripId}:${booking.seatNumber}`;
        const signature = crypto
            .createHmac('sha256', secret)
            .update(qrData)
            .digest('hex');

        const ticket = await TicketModel.create({
            ticketId: `TKT-${uuidv4()}`,
            userId: booking.userId,
            routeId: booking.routeId,
            tripId: booking.tripId,

            qrCode: Buffer.from(qrData).toString('base64'),
            price: booking.totalAmount,

            secret,
            signature,
            expiresAt: booking.scheduledDepartureDate,

            status: TicketStatus.ISSUED,
            syncStatus: 'SYNCED'
        });

        return ticket;
    }

    /**
     * Cancel a booking
     */
    static async cancelBooking(
        bookingId: string,
        cancelledBy: string,
        reason?: string
    ): Promise<IBooking> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');

        if (booking.status === BookingStatus.CANCELLED) {
            throw new Error('Booking already cancelled');
        }

        if (booking.status === BookingStatus.COMPLETED) {
            throw new Error('Cannot cancel completed booking');
        }

        // Release seat
        await TripService.releaseSeat(booking.tripId, booking.seatNumber);

        // Handle refund if already paid
        let refundAmount = 0;
        if (booking.paymentStatus === PaymentStatus.PAID) {
            // Calculate refund (e.g., 90% if cancelled more than 2 hours before departure)
            const hoursUntilDeparture =
                (booking.scheduledDepartureDate.getTime() - Date.now()) / (1000 * 60 * 60);

            if (hoursUntilDeparture > 2) {
                refundAmount = Math.round(booking.totalAmount * 0.9);
            } else if (hoursUntilDeparture > 0) {
                refundAmount = Math.round(booking.totalAmount * 0.5);
            }

            booking.paymentStatus = refundAmount > 0 ?
                PaymentStatus.REFUNDED : PaymentStatus.PAID;
            booking.refundAmount = refundAmount;

            // Deduct from trip revenue
            await TripService.addRevenue(booking.tripId, -booking.totalAmount);
        }

        // Update booking
        booking.status = BookingStatus.CANCELLED;
        booking.cancelledAt = new Date();
        booking.cancelledBy = cancelledBy;
        booking.cancellationReason = reason;
        await booking.save();

        // Cancel ticket if exists
        if (booking.ticketId) {
            await TicketModel.updateOne(
                { ticketId: booking.ticketId },
                { status: TicketStatus.CANCELLED }
            );
        }

        return booking;
    }

    /**
     * Check-in a booking
     */
    static async checkInBooking(
        bookingId: string,
        checkedInBy: string
    ): Promise<IBooking> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');

        if (booking.status !== BookingStatus.CONFIRMED) {
            throw new Error('Only confirmed bookings can be checked in');
        }

        booking.status = BookingStatus.CHECKED_IN;
        booking.checkedInAt = new Date();
        booking.checkedInBy = checkedInBy;
        await booking.save();

        return booking;
    }

    /**
     * Get user bookings
     */
    static async getUserBookings(
        userId: string,
        filters?: {
            status?: BookingStatus;
            startDate?: Date;
            endDate?: Date;
        }
    ): Promise<IBooking[]> {
        const query: any = { userId };

        if (filters?.status) {
            query.status = filters.status;
        }

        if (filters?.startDate || filters?.endDate) {
            query.scheduledDepartureDate = {};
            if (filters.startDate) {
                query.scheduledDepartureDate.$gte = filters.startDate;
            }
            if (filters.endDate) {
                query.scheduledDepartureDate.$lte = filters.endDate;
            }
        }

        return BookingModel.find(query)
            .sort({ scheduledDepartureDate: -1 })
            .limit(50);
    }

    /**
     * Get tenant bookings (for operators/admins)
     */
    static async getTenantBookings(
        tenantId: string,
        filters?: {
            status?: BookingStatus;
            startDate?: Date;
            endDate?: Date;
            branchId?: string;
        }
    ): Promise<IBooking[]> {
        const query: any = { tenantId };

        if (filters?.branchId) {
            query.branchId = filters.branchId;
        }

        if (filters?.status) {
            query.status = filters.status;
        }

        if (filters?.startDate || filters?.endDate) {
            query.scheduledDepartureDate = {};
            if (filters.startDate) {
                query.scheduledDepartureDate.$gte = filters.startDate;
            }
            if (filters.endDate) {
                query.scheduledDepartureDate.$lte = filters.endDate;
            }
        }

        return BookingModel.find(query)
            .sort({ createdAt: -1 })
            .limit(100);
    }

    /**
     * Get trip bookings
     */
    static async getTripBookings(tripId: string): Promise<IBooking[]> {
        return BookingModel.find({ tripId })
            .sort({ seatNumber: 1 });
    }

    /**
     * Get booking by ID
     */
    static async getBookingById(bookingId: string): Promise<IBooking | null> {
        return BookingModel.findOne({ bookingId });
    }
}
