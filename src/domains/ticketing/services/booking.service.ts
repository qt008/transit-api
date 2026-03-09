import { BookingModel, IBooking, BookingStatus, PaymentStatus, PaymentMethod, BookingChannel } from '../models/booking.model';
import { SeatReservationModel, SeatReservationStatus } from '../models/seat-reservation.model';
import { TripService } from '../../fleet/services/trip.service';
import { PricingService } from '../../fleet/services/pricing.service';
import { TripModel } from '../../fleet/models/trip.model';
import { VehicleModel } from '../../fleet/models/vehicle.model';
import { BranchModel } from '../../fleet/models/branch.model';
import { TicketModel, TicketStatus } from '../models/ticket.model';
import { QRCodeService } from './qrcode.service';
import { LedgerEntryModel } from '../../wallet/models/ledger-entry.model';
import { AccountModel } from '../../wallet/models/account.model';
import { WalletService } from '../../wallet/services/wallet.service';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { UserModel } from '../../identity/models/user.model';
import { SMSService } from '../../../services/sms.service';

const TAX_RATE = 0.05;
const walletService = new WalletService();

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
    /** Primary seat. Leave empty for auto-assignment. */
    seatNumber?: string;
    /** Additional seats for multi-seat bookings (family, group). */
    additionalSeats?: string[];
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
    /** Optional group ID to link multiple bookings made together */
    groupId?: string;
}

// ─── Seat availability helper ─────────────────────────────────────────────────

/**
 * Return all seat labels (from vehicle layout) that are NOT actively
 * reserved for the given stop sequence interval [fromSequence, toSequence).
 * Blocking statuses: PENDING and CONFIRMED.
 */
export async function getSegmentAvailableSeats(
    tripId: string,
    fromSequence: number,
    toSequence: number
): Promise<string[]> {
    // Seats blocked by overlapping active reservations
    const blocking = await SeatReservationModel.find({
        tripId,
        status: { $in: [SeatReservationStatus.PENDING, SeatReservationStatus.CONFIRMED] },
        fromSequence: { $lt: toSequence },
        toSequence:   { $gt: fromSequence },
    }).select('seatNumber').lean();

    const takenSeats = new Set(blocking.map(r => r.seatNumber));

    const trip = await TripModel.findOne({ tripId }).lean();
    if (!trip) throw new Error('Trip not found');

    const vehicle = await VehicleModel.findOne({ vehicleId: trip.vehicleId }).lean();

    let allSeats: string[];
    if (vehicle?.seatLayout?.seats?.length) {
        allSeats = (vehicle.seatLayout.seats as any[])
            .filter(s => s.type === 'SEAT' && s.label)
            .map(s => s.label as string);
    } else {
        const total = vehicle?.totalSeats || trip.totalSeats || 40;
        allSeats = Array.from({ length: total }, (_, i) => String(i + 1));
    }

    return allSeats.filter(s => !takenSeats.has(s));
}

/**
 * Check whether a specific seat is free for [fromSequence, toSequence).
 */
async function isSeatAvailable(
    tripId: string,
    seatNumber: string,
    fromSequence: number,
    toSequence: number
): Promise<boolean> {
    const conflict = await SeatReservationModel.findOne({
        tripId,
        seatNumber,
        status: { $in: [SeatReservationStatus.PENDING, SeatReservationStatus.CONFIRMED] },
        fromSequence: { $lt: toSequence },
        toSequence:   { $gt: fromSequence },
    }).lean();
    return !conflict;
}

// ─── BookingService ───────────────────────────────────────────────────────────

export class BookingService {

    /**
     * Create a new booking.
     * - Resolves stop sequences for segment-aware seat locking.
     * - Auto-assigns a seat when seatNumber is not supplied.
     * - Creates a PENDING SeatReservation per seat immediately to hold the
     *   seat during the payment window.
     * - Ticket QR generation happens only after payment is confirmed.
     */
    static async createBooking(input: CreateBookingInput): Promise<IBooking> {
        const executeBooking = async (opts: { session: mongoose.ClientSession | undefined; isTransaction: boolean }) => {
            const { session } = opts;

            // 0. Verify user
            if (input.userId) {
                const userExists = await UserModel.exists({ userId: input.userId }).session(session || null);
                if (!userExists) throw new Error('User not found');
            }

            // 1. Verify trip
            const trip = await TripModel.findOne({ tripId: input.tripId }).session(session || null);
            if (!trip) throw new Error('Trip not found');

            // 1.5 Trip departure check
            const now = new Date();
            const [hours, minutes] = (trip.scheduledDepartureTime || '00:00').split(':').map(Number);
            const departureDateTime = new Date(trip.scheduledDepartureDate);
            departureDateTime.setHours(hours, minutes, 0, 0);

            if (departureDateTime < now) {
                if (trip.status === 'COMPLETED' || trip.status === 'IN_PROGRESS') {
                    throw new Error('Trip has already departed');
                }
                throw new Error(`Trip departed at ${trip.scheduledDepartureTime} on ${new Date(trip.scheduledDepartureDate).toDateString()}`);
            }

            if (trip.status !== 'SCHEDULED' && trip.status !== 'DELAYED') {
                throw new Error(`Cannot book trip with status: ${trip.status}`);
            }

            // 2. Resolve stop sequences
            const fromStop = trip.stops.find(s => s.stopId === input.fromStopId);
            const toStop   = trip.stops.find(s => s.stopId === input.toStopId);
            // For point-to-point (no-stop) routes use 0 → 1 so the interval covers the full trip
            const fromSequence = fromStop?.sequence ?? 0;
            const toSequence   = toStop?.sequence   ?? (fromSequence + 1);

            // 3. Seat assignment
            const allSeatsToBook: string[] = [];

            if (!input.seatNumber) {
                // Auto-assign primary seat
                const available = await getSegmentAvailableSeats(input.tripId, fromSequence, toSequence);
                if (available.length === 0) throw new Error('No seats available for this journey segment');
                allSeatsToBook.push(available[0]);
            } else {
                // Validate primary seat
                const free = await isSeatAvailable(input.tripId, input.seatNumber, fromSequence, toSequence);
                if (!free) throw new Error(`Seat ${input.seatNumber} is not available for this journey segment`);
                allSeatsToBook.push(input.seatNumber);
            }

            // Additional seats (multi-seat booking)
            for (const extra of (input.additionalSeats ?? [])) {
                const free = await isSeatAvailable(input.tripId, extra, fromSequence, toSequence);
                if (!free) throw new Error(`Seat ${extra} is not available for this journey segment`);
                allSeatsToBook.push(extra);
            }

            const primarySeat     = allSeatsToBook[0];
            const additionalSeats = allSeatsToBook.slice(1);

            // 4. Fare calculation
            const fareInfo  = await PricingService.calculateFare(input.routeId, input.fromStopId, input.toStopId);
            const baseFare  = fareInfo.price;
            const discount  = input.discount || 0;
            const taxAmount = Math.round(baseFare * TAX_RATE);
            // Total per seat — multiply by number of seats
            const perSeatTotal = baseFare - discount + taxAmount;
            const totalAmount  = perSeatTotal * allSeatsToBook.length;

            // 5. Stop names
            let fromStopName = trip.stops.find(s => s.stopId === input.fromStopId)?.name;
            let toStopName   = trip.stops.find(s => s.stopId === input.toStopId)?.name;

            if (!fromStopName) {
                const b = await BranchModel.findOne({ branchId: input.fromStopId }).session(session || null);
                if (b) fromStopName = b.name;
            }
            if (!toStopName) {
                const b = await BranchModel.findOne({ branchId: input.toStopId }).session(session || null);
                if (b) toStopName = b.name;
            }
            if (!fromStopName || !toStopName) throw new Error('Invalid stop or branch selection');

            // 6. Generate unique bookingId
            let bookingId = generateBookingId();
            let isUnique  = false;
            let attempts  = 0;
            while (!isUnique && attempts < 5) {
                const existing = await BookingModel.exists({ bookingId }).session(session || null);
                if (!existing) { isUnique = true; } else { bookingId = generateBookingId(); attempts++; }
            }
            if (!isUnique) throw new Error('Failed to generate unique Booking ID. Please try again.');

            // 7. Create booking (PENDING — no ticket yet)
            const [booking] = await BookingModel.create([{
                bookingId,
                userId:   input.userId,
                tripId:   input.tripId,
                routeId:  input.routeId,

                fromStopId:   input.fromStopId,
                fromStopName: fromStopName!,
                toStopId:     input.toStopId,
                toStopName:   toStopName!,
                fromSequence,
                toSequence,

                scheduledDepartureDate: trip.scheduledDepartureDate,
                scheduledDepartureTime: trip.scheduledDepartureTime,

                passengerName:    input.passengerName,
                passengerPhone:   input.passengerPhone,
                passengerEmail:   input.passengerEmail,
                passengerIdNumber: input.passengerIdNumber,

                seatNumber:      primarySeat,
                additionalSeats: additionalSeats,

                baseFare:    baseFare * allSeatsToBook.length,
                discount,
                taxAmount:   taxAmount * allSeatsToBook.length,
                totalAmount,

                paymentStatus: PaymentStatus.PENDING,

                bookedBy:       input.bookedBy,
                bookedByRole:   input.bookedByRole,
                bookingChannel: input.channel,
                groupId:        input.groupId,

                status:    BookingStatus.PENDING,
                tenantId:  input.tenantId,
                branchId:  input.branchId,
            }], { session: session || undefined });

            // 8. Create PENDING SeatReservation for every seat
            const reservationDocs = allSeatsToBook.map(seat => ({
                reservationId: `RSRV-${uuidv4()}`,
                tripId:        input.tripId,
                seatNumber:    seat,
                bookingId:     booking.bookingId,
                userId:        input.userId,
                fromStopId:    input.fromStopId,
                toStopId:      input.toStopId,
                fromSequence,
                toSequence,
                status:    SeatReservationStatus.PENDING,
                tenantId:  input.tenantId,
            }));
            await SeatReservationModel.insertMany(reservationDocs, { session: session || undefined } as any);

            return booking;
        };

        // Transaction wrapper (falls back gracefully on standalone MongoDB)
        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            const booking = await executeBooking({ session, isTransaction: true });
            await session.commitTransaction();
            return booking;
        } catch (error: any) {
            await session.abortTransaction();
            if (error.message?.includes('Transaction numbers') || error.message?.includes('replica set')) {
                console.warn('⚠️ Standalone DB — retrying without transaction');
                return executeBooking({ session: undefined, isTransaction: false });
            }
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Process payment for a booking.
     * Supports WALLET (debit user's wallet) and all other payment methods.
     * Generates one QR ticket per seat after payment is confirmed.
     */
    static async processPayment(
        bookingId: string,
        paymentMethod: PaymentMethod,
        paymentReference?: string,
        /** Required when paymentMethod === WALLET */
        walletAccountId?: string,
    ): Promise<{ booking: IBooking; tickets: any[] }> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');
        if (booking.paymentStatus === PaymentStatus.PAID) throw new Error('Booking already paid');

        // ── Wallet payment ───────────────────────────────────────────────────
        if (paymentMethod === PaymentMethod.WALLET) {
            const accountId = walletAccountId;
            if (!accountId) throw new Error('walletAccountId is required for wallet payment');

            const account = await AccountModel.findOne({ accountId });
            if (!account) throw new Error('Wallet account not found');
            if (account.balance < booking.totalAmount) {
                throw new Error(
                    `Insufficient wallet balance. Required: GH₵ ${(booking.totalAmount / 100).toFixed(2)}, ` +
                    `available: GH₵ ${(account.balance / 100).toFixed(2)}`
                );
            }
            await walletService.debitWallet(
                accountId,
                booking.totalAmount,
                `Ticket payment: ${booking.bookingId}`
            );
        }

        // ── Update booking ───────────────────────────────────────────────────
        booking.paymentStatus  = PaymentStatus.PAID;
        booking.paymentMethod  = paymentMethod;
        booking.paymentReference = paymentReference || `PAY-${uuidv4()}`;
        booking.paidAt  = new Date();
        booking.status  = BookingStatus.CONFIRMED;
        await booking.save();

        // Confirm seat reservations
        await SeatReservationModel.updateMany(
            { bookingId: booking.bookingId, status: SeatReservationStatus.PENDING },
            { status: SeatReservationStatus.CONFIRMED }
        );

        // Trip revenue
        await TripService.addRevenue(booking.tripId, booking.totalAmount);

        // Analytics ledger entry
        try {
            await LedgerEntryModel.create({
                transactionId: `TXN-${uuidv4()}`,
                accountId:     booking.tenantId || 'SYSTEM_REVENUE',
                amount:        booking.totalAmount,
                type:          'CREDIT',
                balanceAfter:  0,
                description:   `Ticket Revenue: ${booking.bookingId}`,
                metadata: {
                    bookingId: booking.bookingId,
                    tripId:    booking.tripId,
                    routeId:   booking.routeId,
                    operatorId: booking.tenantId,
                },
            });
        } catch (err) {
            console.error('Failed to record ledger entry:', err);
        }

        // ── Generate one ticket per seat ──────────────────────────────────────
        const allSeats = [booking.seatNumber, ...(booking.additionalSeats ?? [])];
        const tickets: any[] = [];

        for (const seat of allSeats) {
            const ticket = await BookingService.generateTicket(booking, seat);
            tickets.push(ticket);
        }

        // Link tickets back to booking
        booking.ticketId  = tickets[0]?.ticketId;
        booking.ticketIds = tickets.map(t => t.ticketId);
        await booking.save();

        // SMS confirmation (non-blocking)
        try {
            const smsService = new SMSService();
            await smsService.sendBookingConfirmation(booking.passengerPhone, {
                bookingId:     booking.bookingId,
                origin:        booking.fromStopName,
                destination:   booking.toStopName,
                departureDate: booking.scheduledDepartureDate,
                departureTime: booking.scheduledDepartureTime,
                seatNumber:    booking.seatNumber,
            });
        } catch (smsErr) {
            console.error('SMS failed:', smsErr);
        }

        return { booking, tickets };
    }

    /**
     * Generate a single scannable QR ticket for a given seat on a booking.
     */
    private static async generateTicket(booking: IBooking, seatNumber: string): Promise<any> {
        const ticketId  = `TKT-${uuidv4()}`;
        const expiresAt = booking.scheduledDepartureDate;

        const { qrCode, signature, secret } = await QRCodeService.generateTicketQR({
            ticketId,
            userId:  booking.userId,
            routeId: booking.routeId,
            price:   booking.totalAmount,
            expiresAt,
        });

        return TicketModel.create({
            ticketId,
            userId:    booking.userId,
            routeId:   booking.routeId,
            tripId:    booking.tripId,
            qrCode,
            price:     booking.totalAmount,
            secret,
            signature,
            expiresAt,
            status:     TicketStatus.ISSUED,
            syncStatus: 'SYNCED',
            // Store seat on ticket for conductor display
            seatNumber,
        });
    }

    /**
     * Cancel a booking — releases seat reservations, optionally refunds.
     */
    static async cancelBooking(
        bookingId: string,
        cancelledBy: string,
        reason?: string
    ): Promise<IBooking> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');
        if (booking.status === BookingStatus.CANCELLED)  throw new Error('Booking already cancelled');
        if (booking.status === BookingStatus.COMPLETED)  throw new Error('Cannot cancel completed booking');

        // Release all seat reservations for this booking
        await SeatReservationModel.updateMany(
            { bookingId: booking.bookingId },
            { status: SeatReservationStatus.CANCELLED }
        );

        // Keep trip counter consistent (best-effort)
        const allSeats = [booking.seatNumber, ...(booking.additionalSeats ?? [])];
        for (const seat of allSeats) {
            await TripService.releaseSeat(booking.tripId, seat).catch(() => null);
        }

        // Refund calculation
        let refundAmount = 0;
        if (booking.paymentStatus === PaymentStatus.PAID) {
            const hoursUntilDep = (booking.scheduledDepartureDate.getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursUntilDep > 2)        refundAmount = Math.round(booking.totalAmount * 0.9);
            else if (hoursUntilDep > 0)   refundAmount = Math.round(booking.totalAmount * 0.5);

            booking.paymentStatus = refundAmount > 0 ? PaymentStatus.REFUNDED : PaymentStatus.PAID;
            booking.refundAmount  = refundAmount;
            await TripService.addRevenue(booking.tripId, -booking.totalAmount);
        }

        booking.status             = BookingStatus.CANCELLED;
        booking.cancelledAt        = new Date();
        booking.cancelledBy        = cancelledBy;
        booking.cancellationReason = reason;
        await booking.save();

        // Cancel all tickets
        const ticketIds = booking.ticketIds?.length ? booking.ticketIds : (booking.ticketId ? [booking.ticketId] : []);
        if (ticketIds.length) {
            await TicketModel.updateMany({ ticketId: { $in: ticketIds } }, { status: TicketStatus.CANCELLED });
        }

        return booking;
    }

    /**
     * Check-in a booking (CONFIRMED → CHECKED_IN).
     */
    static async checkInBooking(bookingId: string, checkedInBy: string): Promise<IBooking> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');
        if (booking.status !== BookingStatus.CONFIRMED) throw new Error('Only confirmed bookings can be checked in');

        booking.status       = BookingStatus.CHECKED_IN;
        booking.checkedInAt  = new Date();
        booking.checkedInBy  = checkedInBy;
        await booking.save();
        return booking;
    }

    /**
     * Release seat reservations when a journey closes (tap-off).
     * Marks the booking COMPLETED and all its SeatReservations RELEASED.
     */
    static async releaseSeatsOnJourneyClose(userId: string, tripId: string): Promise<void> {
        const bookings = await BookingModel.find({
            userId,
            tripId,
            status: { $in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
            paymentStatus: PaymentStatus.PAID,
        });

        for (const booking of bookings) {
            await SeatReservationModel.updateMany(
                { bookingId: booking.bookingId, status: SeatReservationStatus.CONFIRMED },
                { status: SeatReservationStatus.RELEASED, releasedAt: new Date() }
            );
            await BookingModel.updateOne(
                { bookingId: booking.bookingId },
                { status: BookingStatus.COMPLETED }
            );
        }
    }

    /**
     * Fetch pre-booked confirmed tickets for a user on a trip at a given stop.
     * Used by the transit scan flow to detect pre-booked passengers.
     * Returns an array of ticket data ready for conductor display/printing.
     */
    static async getPreBookedTickets(
        userId: string,
        tripId: string,
        currentStopSequence: number,
    ): Promise<Array<{
        bookingId:    string;
        seatNumber:   string;
        passengerName: string;
        fromStopName: string;
        toStopName:   string;
        ticketId:     string;
        qrCode:       string;
    }>> {
        // Find confirmed bookings where the current stop falls within the booked segment
        const bookings = await BookingModel.find({
            userId,
            tripId,
            status:        { $in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
            paymentStatus: PaymentStatus.PAID,
            fromSequence:  { $lte: currentStopSequence },
            toSequence:    { $gt:  currentStopSequence },
        }).lean();

        if (!bookings.length) return [];

        const results: any[] = [];

        for (const b of bookings) {
            const ticketIds = b.ticketIds?.length ? b.ticketIds : (b.ticketId ? [b.ticketId] : []);
            const allSeats  = [b.seatNumber, ...(b.additionalSeats ?? [])];

            for (let i = 0; i < ticketIds.length; i++) {
                const ticket = await TicketModel.findOne({ ticketId: ticketIds[i] }).lean();
                if (!ticket) continue;
                results.push({
                    bookingId:    b.bookingId,
                    seatNumber:   (ticket as any).seatNumber || allSeats[i] || b.seatNumber,
                    passengerName: b.passengerName,
                    fromStopName: b.fromStopName,
                    toStopName:   b.toStopName,
                    ticketId:     ticket.ticketId,
                    qrCode:       ticket.qrCode,
                });
            }
        }

        return results;
    }

    // ─── Query methods (unchanged) ─────────────────────────────────────────

    static async getUserBookings(
        userId: string,
        filters?: { status?: BookingStatus; startDate?: Date; endDate?: Date }
    ): Promise<IBooking[]> {
        const query: any = { userId };
        if (filters?.status) query.status = filters.status;
        if (filters?.startDate || filters?.endDate) {
            query.scheduledDepartureDate = {};
            if (filters?.startDate) query.scheduledDepartureDate.$gte = filters.startDate;
            if (filters?.endDate)   query.scheduledDepartureDate.$lte = filters.endDate;
        }
        return BookingModel.find(query).sort({ scheduledDepartureDate: -1 }).limit(50);
    }

    static async getTenantBookings(
        tenantId: string,
        filters?: { status?: BookingStatus; startDate?: Date; endDate?: Date; branchId?: string }
    ): Promise<IBooking[]> {
        const query: any = { tenantId };
        if (filters?.branchId) query.branchId = filters.branchId;
        if (filters?.status)   query.status    = filters.status;
        if (filters?.startDate || filters?.endDate) {
            query.scheduledDepartureDate = {};
            if (filters?.startDate) query.scheduledDepartureDate.$gte = filters.startDate;
            if (filters?.endDate)   query.scheduledDepartureDate.$lte = filters.endDate;
        }
        return BookingModel.find(query).sort({ createdAt: -1 }).limit(100);
    }

    static async getTripBookings(tripId: string): Promise<IBooking[]> {
        return BookingModel.find({ tripId }).sort({ seatNumber: 1 });
    }

    static async getBookingById(bookingId: string): Promise<any | null> {
        const booking = await BookingModel.findOne({ bookingId }).lean();
        if (!booking) return null;

        const trip = await TripModel.findOne({ tripId: booking.tripId }).lean();

        let departureTime: Date = booking.scheduledDepartureDate;
        let arrivalTime:   Date = booking.scheduledDepartureDate;
        let durationMinutes     = 0;

        if (trip) {
            const fromStop = trip.stops.find(s => s.stopId === booking.fromStopId);
            const toStop   = trip.stops.find(s => s.stopId === booking.toStopId);
            if (fromStop && toStop) {
                const base    = new Date(trip.scheduledDepartureDate).getTime();
                departureTime = new Date(base + (fromStop.estimatedArrivalMinutes || 0) * 60000);
                arrivalTime   = new Date(base + (toStop.estimatedArrivalMinutes || 0)   * 60000);
                durationMinutes = (toStop.estimatedArrivalMinutes || 0) - (fromStop.estimatedArrivalMinutes || 0);
            }
        }

        // Fetch primary QR code — prefer ticketId, fall back to first entry in ticketIds
        let qrCode: string | undefined;
        const primaryTicketId = booking.ticketId || booking.ticketIds?.[0];
        if (primaryTicketId) {
            const ticket = await TicketModel.findOne({ ticketId: primaryTicketId }).lean();
            qrCode = ticket?.qrCode;
        }

        return {
            ...booking,
            passengerDepartureDate: departureTime,
            passengerArrivalDate:   arrivalTime,
            tripDurationMinutes:    durationMinutes,
            ...(qrCode ? { qrCode } : {}),
        };
    }

    static async initiateMobileMoneyPayment(bookingId: string, phone: string, provider: string): Promise<any> {
        const booking = await BookingModel.findOne({ bookingId });
        if (!booking) throw new Error('Booking not found');

        const { PawaPayService } = await import('../../payment/services/pawapay.service');

        if (process.env.PAYMENT_MODE === 'TEST') {
            const mockId = `MOCK-${uuidv4()}`;
            await BookingService.processPayment(bookingId, PaymentMethod.MOBILE_MONEY, mockId);
            return { success: true, message: 'Mock payment (Test Mode)', paymentStatus: 'PAID', depositId: mockId };
        }

        const response = await PawaPayService.initiateDeposit({
            amount:       (booking.totalAmount / 100).toFixed(2),
            currency:     'GHS',
            country:      'GH',
            phoneNumber:  phone,
            correspondent: provider,
            description:  `TKT ${booking.bookingId}`,
            orderId:      booking.bookingId,
        });

        booking.paymentReference = response.depositId;
        await booking.save();

        return { success: true, message: 'Payment prompt sent', paymentStatus: 'PENDING_AUTHORIZATION', depositId: response.depositId };
    }
}
