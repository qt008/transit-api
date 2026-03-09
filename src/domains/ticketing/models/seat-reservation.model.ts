import { Schema, model, Document } from 'mongoose';

export enum SeatReservationStatus {
    PENDING   = 'PENDING',    // Booking created, payment not yet processed
    CONFIRMED = 'CONFIRMED',  // Payment confirmed — seat firmly held
    RELEASED  = 'RELEASED',   // Passenger tapped off — seat open for next segment
    CANCELLED = 'CANCELLED',  // Booking cancelled
}

export interface ISeatReservation extends Document {
    reservationId: string;
    tripId: string;
    seatNumber: string;
    bookingId: string;
    userId: string;
    fromStopId: string;
    toStopId: string;
    /** Sequence of the boarding stop (for interval overlap maths) */
    fromSequence: number;
    /** Sequence of the alighting stop (exclusive upper bound) */
    toSequence: number;
    status: SeatReservationStatus;
    releasedAt?: Date;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
}

const SeatReservationSchema = new Schema<ISeatReservation>({
    reservationId: { type: String, required: true, unique: true, index: true },
    tripId:        { type: String, required: true, index: true },
    seatNumber:    { type: String, required: true },
    bookingId:     { type: String, required: true, index: true },
    userId:        { type: String, required: true, index: true },
    fromStopId:    { type: String, required: true },
    toStopId:      { type: String, required: true },
    fromSequence:  { type: Number, required: true },
    toSequence:    { type: Number, required: true },
    status: {
        type:    String,
        enum:    Object.values(SeatReservationStatus),
        default: SeatReservationStatus.PENDING,
        index:   true,
    },
    releasedAt: { type: Date },
    tenantId:   { type: String, required: true, index: true },
}, { timestamps: true });

/**
 * Compound index optimised for the overlap query:
 * "find all active reservations for this trip+seat whose [fromSeq, toSeq)
 *  overlaps the requested [reqFrom, reqTo)"
 */
SeatReservationSchema.index({ tripId: 1, seatNumber: 1, status: 1 });
SeatReservationSchema.index({ tripId: 1, status: 1, fromSequence: 1, toSequence: 1 });
SeatReservationSchema.index({ userId: 1, tripId: 1, status: 1 });

export const SeatReservationModel = model<ISeatReservation>('SeatReservation', SeatReservationSchema);
