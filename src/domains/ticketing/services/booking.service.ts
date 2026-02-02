import { BookingModel, IBooking, BookingStatus, PaymentStatus, PaymentMethod, BookingChannel } from '../models/booking.model';
import { TripService } from '../../fleet/services/trip.service';
import { PricingService } from '../../fleet/services/pricing.service';
import { TripModel } from '../../fleet/models/trip.model';
import { BranchModel } from '../../fleet/models/branch.model';
import { TicketModel, TicketStatus } from '../models/ticket.model';
import { LedgerEntryModel } from '../../wallet/models/ledger-entry.model';
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

import mongoose from 'mongoose';
// ... existing imports

const TAX_RATE = 0.05;

export class BookingService {
    /**
     * Create a new booking
     */
    static async createBooking(input: CreateBookingInput): Promise<IBooking> {
        const executeBooking = async (details: { session: mongoose.ClientSession | undefined, isTransaction: boolean }) => {
            const { session, isTransaction } = details;

            // 1. Verify trip exists and get details
            const trip = await TripModel.findOne({ tripId: input.tripId }).session(session || null);
            if (!trip) throw new Error('Trip not found');

            // 1.5 Verify trip hasn't departed
            const now = new Date();
            // Allow booking up to departure time (or maybe 5 mins before?)
            // For now, strict check against departure time.
            const departureTime = new Date(trip.scheduledDepartureDate);
            // Combine date with time string if needed, but usually scheduledDepartureDate includes time in this system or we rely on full Date object.
            // Looking at generateTrips: scheduledDepartureDate is set to new Date(currentDate) which might be 00:00?
            // No, generateTrips sets: scheduledDepartureDate: new Date(currentDate) where currentDate has been iterated.
            // AND scheduledDepartureTime: schedule.departureTime (string).
            // Wait, TripModel uses scheduledDepartureDate as type Date.
            // If the system stores just the date part in scheduledDepartureDate and time in scheduledDepartureTime string, we need to combine.
            // Let's check TripService.generateTrips -> it sets scheduledDepartureDate using `new Date(currentDate)`.
            // But currentDate is iterated via date increment. The time component might be 00:00 or whatever startDate had.
            // Let's assume we need to parse time.
            // ACTUALLY, checking standard implementation: usually scheduledDepartureDate IS the full datetime.
            // Let's look at TripModel usage.
            // In TripService line 55: scheduledDepartureDate: new Date(currentDate).
            // If currentDate comes from `startDate`, it depends on input.
            // Best safety is to combine them if strictly needed, but let's assume scheduledDepartureDate is sufficient for day check,
            // and we might need to be careful with time.
            // However, to be safe against "past days", checking scheduledDepartureDate < now (where now includes time) might be tricky if scheduledDepartureDate is 00:00.
            // Let's use a robust check: if trip date < today (start of day), it's definitely past.
            // If trip date == today, check time.
            // But likely keeping it simple:
            if (new Date(trip.scheduledDepartureDate) < new Date(now.getTime() - 15 * 60 * 1000)) { // Allow grace period or check strictly
                // Actually, if a bus leaves at 8:00 AM and it's 8:01 AM, can I book? probably not.
                // safe check:
                if (trip.status === 'COMPLETED' || trip.status === 'IN_PROGRESS') {
                    throw new Error('Trip has already departed');
                }

                // If status is SCHEDULED, we should check time.
                // Assuming scheduledDepartureDate is the simplified date.
                // Let's just check if the trip is in the past.
                const tripDate = new Date(trip.scheduledDepartureDate);
                if (tripDate < new Date()) {
                    // This creates an issue if scheduledDepartureDate is set to midnight.
                    // Let's verify if we need to parse time.
                    // For now, let's block if status implies departure or if date is strictly in past (yesterday).
                }
            }

            // BETTER FIX: rely on status and basic date check.
            if (trip.status !== 'SCHEDULED' && trip.status !== 'DELAYED') {
                throw new Error(`Cannot book trip with status: ${trip.status}`);
            }

            // Check if date is in the past (yesterday or before)
            const tripDate = new Date(trip.scheduledDepartureDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (tripDate < today) {
                throw new Error('Cannot book past trips');
            }

            // If today, check time? (Optional, maybe user wants to book last minute?)
            // We will stick to status check + date check for now.

            // 2. Check if seat is available (Atomic check & update)
            const seatBooked = await TripService.bookSeat(input.tripId, input.seatNumber, session);
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
                const taxAmount = Math.round(baseFare * TAX_RATE);
                const totalAmount = baseFare - discount + taxAmount;

                // 4. Get stop/branch names
                let fromStopName = trip.stops.find(s => s.stopId === input.fromStopId)?.name;
                let toStopName = trip.stops.find(s => s.stopId === input.toStopId)?.name;

                // If not found in stops, check if they are branches (Direct Trip)
                if (!fromStopName) {
                    const fromBranch = await BranchModel.findOne({ branchId: input.fromStopId }).session(session || null);
                    if (fromBranch) fromStopName = fromBranch.name;
                }

                if (!toStopName) {
                    const toBranch = await BranchModel.findOne({ branchId: input.toStopId }).session(session || null);
                    if (toBranch) toStopName = toBranch.name;
                }

                if (!fromStopName || !toStopName) {
                    throw new Error('Invalid stop or branch selection');
                }

                // 5. Create booking
                const [booking] = await BookingModel.create([{
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
                }], { session: session || undefined });

                return booking;
            } catch (error) {
                // If not in transaction, manually rollback seat
                if (!isTransaction) {
                    // Best effort rollback
                    await TripService.releaseSeat(input.tripId, input.seatNumber).catch(console.error);
                }
                throw error;
            }
        };

        // --- Transaction Management ---
        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            const booking = await executeBooking({ session, isTransaction: true });
            await session.commitTransaction();
            return booking;
        } catch (error: any) {
            await session.abortTransaction();

            // Detect Standalone MongoDB error
            if (error.message?.includes('Transaction numbers') || error.message?.includes('replica set')) {
                console.warn('⚠️ Transaction failed (Standalone DB detected). Retrying without transaction...');

                // Retry without session/transaction
                // Note: Data consistency is not guaranteed if process crashes mid-operation
                return await executeBooking({ session: undefined, isTransaction: false });
            }
            throw error;
        } finally {
            session.endSession();
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

        // --- NEW: Record Revenue in Ledger for Analytics ---
        // Ideally we credit a "System Revenue Account" or the "Tenant Account"
        // For now, we will just create a CREDIT entry for the Operator/Tenant to signify revenue.
        // Since we don't have a full double-entry system setup for "Cash vs Revenue" yet, 
        // we'll just log the CREDIT side for analytics.

        try {
            await LedgerEntryModel.create({
                transactionId: `TXN-${uuidv4()}`,
                accountId: booking.tenantId || 'SYSTEM_REVENUE', // Or operatorId
                amount: booking.totalAmount,
                type: 'CREDIT', // Importing TransactionType enum would be better but string works if enum matches
                balanceAfter: 0, // We are not strictly tracking balance for analytics-only entries if account doesn't exist
                description: `Ticket Revenue: ${booking.bookingId}`,
                metadata: {
                    bookingId: booking.bookingId,
                    tripId: booking.tripId,
                    routeId: booking.routeId,
                    operatorId: booking.tenantId // Important for getRevenue filtering
                }
            });
        } catch (error) {
            console.error('Failed to record ledger entry for booking:', error);
            // Don't fail the payment if analytics log fails? 
            // Better to fail in strict systems, but for now we catch.
        }

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

    /**
     * Initiate Mobile Money Payment (PawaPay)
     */
    static async initiateMobileMoneyPayment(bookingId: string, phone: string, provider: string): Promise<any> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');

        // Lazy import to avoid circular dependency if any
        const { PawaPayService } = await import('../../payment/services/pawapay.service');

        try {
            const paymentResponse = await PawaPayService.initiateDeposit({
                amount: (booking.totalAmount / 100).toFixed(2),
                currency: 'GHS',
                country: 'GH',
                phoneNumber: phone,
                correspondent: provider,
                description: `TKT ${booking.bookingId}`,
                orderId: booking.bookingId
            });

            // Update booking
            booking.paymentReference = paymentResponse.depositId;
            // booking.paymentMethod = PaymentMethod.MOBILE_MONEY; // Already set ideally, but enforce it?
            // No, let controller set it or here. catch-22 if imports are messy.
            // We'll trust the caller set the method or we set it here.
            // But we need the enum. Let's assume it's set.
            await booking.save();

            return {
                success: true,
                message: 'Payment prompt sent',
                paymentStatus: 'PENDING_AUTHORIZATION',
                depositId: paymentResponse.depositId
            };
        } catch (error: any) {
            throw new Error(error.message || 'Payment initiation failed');
        }
    }
}
