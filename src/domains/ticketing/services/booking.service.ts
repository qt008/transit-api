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
import { UserModel } from '../../identity/models/user.model';
import { SMSService } from '../../../services/sms.service';
// ... existing imports

const TAX_RATE = 0.05;

export class BookingService {
    /**
     * Create a new booking
     */
    static async createBooking(input: CreateBookingInput): Promise<IBooking> {
        const executeBooking = async (details: { session: mongoose.ClientSession | undefined, isTransaction: boolean }) => {
            const { session, isTransaction } = details;

            // 0. Verify User Exists
            if (input.userId) { // userId should be required but input type suggests it is.
                const userExists = await UserModel.exists({ userId: input.userId }).session(session || null);
                if (!userExists) throw new Error('User not found');
            }

            // 1. Verify trip exists and get details
            const trip = await TripModel.findOne({ tripId: input.tripId }).session(session || null);
            if (!trip) throw new Error('Trip not found');

            // 1.5 Verify trip hasn't departed (Strict Date + Time Check)
            const now = new Date();
            const tripDate = new Date(trip.scheduledDepartureDate);

            // Parse time string "HH:mm"
            const [hours, minutes] = (trip.scheduledDepartureTime || '00:00').split(':').map(Number);

            // Set time on the trip date object
            const departureDateTime = new Date(tripDate);
            departureDateTime.setHours(hours, minutes, 0, 0);

            // Allow 5 minutes grace period? keeping it strict for now.
            if (departureDateTime < now) {
                // If status is COMPLETED/IN_PROGRESS, it's definitely too late
                if (trip.status === 'COMPLETED' || trip.status === 'IN_PROGRESS') {
                    throw new Error('Trip has already departed');
                }

                // If SCHEDULED but time passed -> Error
                throw new Error(`Trip departed at ${trip.scheduledDepartureTime} on ${tripDate.toDateString()}`);
            }

            if (trip.status !== 'SCHEDULED' && trip.status !== 'DELAYED') {
                throw new Error(`Cannot book trip with status: ${trip.status}`);
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

                // 5. Create booking - with Uniqueness Check
                let bookingId = generateBookingId();
                let isUnique = false;
                let attempts = 0;

                while (!isUnique && attempts < 5) {
                    const existing = await BookingModel.exists({ bookingId }).session(session || null);
                    if (!existing) {
                        isUnique = true;
                    } else {
                        bookingId = generateBookingId();
                        attempts++;
                    }
                }

                if (!isUnique) {
                    throw new Error('Failed to generate unique Booking ID. Please try again.');
                }

                const [booking] = await BookingModel.create([{
                    bookingId,
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

        // Send Confirmation SMS (Async/Fire-and-forget)
        try {
            const smsService = new SMSService();
            // Resolve stop names for SMS if possible (already in booking object!)
            // booking.fromStopName / toStopName should be populated.

            await smsService.sendBookingConfirmation(booking.passengerPhone, {
                bookingId: booking.bookingId,
                origin: booking.fromStopName,
                destination: booking.toStopName,
                departureDate: booking.scheduledDepartureDate,
                departureTime: booking.scheduledDepartureTime,
                seatNumber: booking.seatNumber
            });
        } catch (smsError) {
            console.error('Failed to send booking confirmation SMS:', smsError);
            // Non-blocking
        }

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
    /**
     * Get booking by ID
     */
    static async getBookingById(bookingId: string): Promise<any | null> {
        const booking = await BookingModel.findOne({ bookingId }).lean();
        if (!booking) return null;

        // Fetch trip to get stop offsets
        const trip = await TripModel.findOne({ tripId: booking.tripId }).lean();

        let departureTime = booking.scheduledDepartureDate;
        let arrivalTime = booking.scheduledDepartureDate;
        let durationMinutes = 0;

        if (trip) {
            const fromStop = trip.stops.find(s => s.stopId === booking.fromStopId);
            const toStop = trip.stops.find(s => s.stopId === booking.toStopId);

            if (fromStop && toStop) {
                // Determine base start time from trip
                // Assuming scheduledDepartureDate includes the time, or we use scheduledDepartureTime to adjust
                // For now, let's assume scheduledDepartureDate is correct base.
                const baseTime = new Date(trip.scheduledDepartureDate).getTime();

                const depOffset = (fromStop.estimatedArrivalMinutes || 0) * 60000;
                const arrOffset = (toStop.estimatedArrivalMinutes || 0) * 60000;

                departureTime = new Date(baseTime + depOffset);
                arrivalTime = new Date(baseTime + arrOffset);
                durationMinutes = (toStop.estimatedArrivalMinutes || 0) - (fromStop.estimatedArrivalMinutes || 0);
            }
        }

        return {
            ...booking,
            passengerDepartureDate: departureTime,
            passengerArrivalDate: arrivalTime,
            tripDurationMinutes: durationMinutes
        };
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
            // Check Env for Test Mode
            if (process.env.PAYMENT_MODE === 'TEST') {
                const mockDepositId = `MOCK-${uuidv4()}`;
                console.log(`ℹ️ [BookingService] TEST MODE: Instantly processing payment for ${bookingId}`);

                // Instant mock payment
                await BookingService.processPayment(bookingId, PaymentMethod.MOBILE_MONEY, mockDepositId);

                return {
                    success: true,
                    message: 'Mock payment successful (Test Mode)',
                    paymentStatus: 'PAID',
                    depositId: mockDepositId
                };
            }

            const paymentResponse = await PawaPayService.initiateDeposit({
                amount: (booking.totalAmount / 100).toFixed(2),
                currency: 'GHS',
                country: 'GH',
                phoneNumber: phone,
                correspondent: provider,
                description: `TKT ${booking.bookingId}`,
                orderId: booking.bookingId
            });

            // Update booking reference
            booking.paymentReference = paymentResponse.depositId;
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
