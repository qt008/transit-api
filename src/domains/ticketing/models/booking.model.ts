import { Schema, model, Document } from 'mongoose';

export enum BookingStatus {
    PENDING = 'PENDING',
    CONFIRMED = 'CONFIRMED',
    CANCELLED = 'CANCELLED',
    CHECKED_IN = 'CHECKED_IN',
    COMPLETED = 'COMPLETED',
    NO_SHOW = 'NO_SHOW'
}

export enum PaymentStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    REFUNDED = 'REFUNDED',
    PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED'
}

export enum PaymentMethod {
    CASH = 'CASH',
    MOMO = 'MOMO',
    CARD = 'CARD',
    WALLET = 'WALLET',
    BANK_TRANSFER = 'BANK_TRANSFER',
    MOBILE_MONEY = "MOBILE_MONEY"
}

export enum BookingChannel {
    WEB = 'WEB',
    MOBILE = 'MOBILE',
    POS = 'POS', // Point of Sale / Operator
    USSD = 'USSD',
    API = 'API'
}

export interface IBooking extends Document {
    bookingId: string;
    userId: string; // Passenger or customer
    tripId: string;

    // Journey details
    routeId: string;
    routeName?: string;
    fromStopId: string;
    fromStopName: string;
    toStopId: string;
    toStopName: string;

    // Schedule info (for reference)
    scheduledDepartureDate: Date;
    scheduledDepartureTime: string;

    // Passenger info
    passengerName: string;
    passengerPhone: string;
    passengerEmail?: string;
    passengerIdNumber?: string; // Optional ID for long-distance travel

    // Seat assignment
    seatNumber: string;

    // Pricing
    baseFare: number; // In pesewas
    discount: number;
    taxAmount: number;
    totalAmount: number;

    // Payment
    paymentStatus: PaymentStatus;
    paymentMethod?: PaymentMethod;
    paymentReference?: string;
    paidAt?: Date;

    // Metadata
    bookedBy: string; // userId of operator if POS sale
    bookedByRole?: string; // Role of person who made booking
    bookingChannel: BookingChannel;

    // Status
    status: BookingStatus;

    // Check-in
    checkedInAt?: Date;
    checkedInBy?: string;

    // Cancellation
    cancelledAt?: Date;
    cancelledBy?: string;
    cancellationReason?: string;
    refundAmount?: number;

    // Tenant context
    tenantId: string;
    branchId?: string; // Branch where booking was made

    // Ticket reference (created after payment)
    ticketId?: string;

    createdAt: Date;
    updatedAt: Date;
}

const BookingSchema = new Schema({
    bookingId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    tripId: { type: String, required: true, index: true },

    routeId: { type: String, required: true, index: true },
    routeName: { type: String },
    fromStopId: { type: String, required: true },
    fromStopName: { type: String, required: true },
    toStopId: { type: String, required: true },
    toStopName: { type: String, required: true },

    scheduledDepartureDate: { type: Date, required: true, index: true },
    scheduledDepartureTime: { type: String, required: true },

    passengerName: { type: String, required: true },
    passengerPhone: { type: String, required: true },
    passengerEmail: { type: String },
    passengerIdNumber: { type: String },

    seatNumber: { type: String, required: true },

    baseFare: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },

    paymentStatus: {
        type: String,
        enum: Object.values(PaymentStatus),
        default: PaymentStatus.PENDING,
        index: true
    },
    paymentMethod: { type: String, enum: Object.values(PaymentMethod) },
    paymentReference: { type: String },
    paidAt: { type: Date },

    bookedBy: { type: String, required: true, index: true },
    bookedByRole: { type: String },
    bookingChannel: {
        type: String,
        enum: Object.values(BookingChannel),
        required: true
    },

    status: {
        type: String,
        enum: Object.values(BookingStatus),
        default: BookingStatus.PENDING,
        index: true
    },

    checkedInAt: { type: Date },
    checkedInBy: { type: String },

    cancelledAt: { type: Date },
    cancelledBy: { type: String },
    cancellationReason: { type: String },
    refundAmount: { type: Number },

    tenantId: { type: String, required: true, index: true },
    branchId: { type: String, index: true },

    ticketId: { type: String, index: true },
}, {
    timestamps: true
});

// Compound indexes for common queries
BookingSchema.index({ tripId: 1, status: 1 });
BookingSchema.index({ userId: 1, status: 1, scheduledDepartureDate: -1 });
BookingSchema.index({ branchId: 1, scheduledDepartureDate: 1 });
BookingSchema.index({ paymentStatus: 1, createdAt: -1 });
BookingSchema.index({ tripId: 1, seatNumber: 1 }, { unique: true, sparse: true }); // Prevent double-booking same seat

export const BookingModel = model<IBooking>('Booking', BookingSchema);
