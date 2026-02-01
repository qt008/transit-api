import { Schema, model, Document } from 'mongoose';
import { RouteStop } from './route.model';

export enum TripStatus {
    SCHEDULED = 'SCHEDULED',
    BOARDING = 'BOARDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    DELAYED = 'DELAYED'
}

export interface ITrip extends Document {
    tripId: string;
    scheduleId: string;
    routeId: string;
    vehicleId: string;
    driverId: string;
    branchId: string; // Operating branch
    operatorId: string;
    tenantId: string;

    // Specific departure instance
    scheduledDepartureDate: Date; // e.g., 2026-02-01
    scheduledDepartureTime: string; // e.g., "07:30" (from schedule)
    actualDepartureTime?: Date;
    actualArrivalTime?: Date;

    // Status tracking
    status: TripStatus;
    currentStopIndex: number;
    eta?: Date;

    // Seat tracking
    totalSeats: number; // From vehicle capacity
    availableSeats: number;
    bookedSeats: string[]; // Array of seat numbers that are booked

    // Stops (snapshot from route at time of trip creation)
    stops: RouteStop[];

    // Financial
    passengers: number;
    revenue: number; // Sum of all bookings

    // Metadata
    createdBy?: string;
    notes?: string;

    createdAt: Date;
    updatedAt: Date;
}

const TripSchema = new Schema({
    tripId: { type: String, required: true, unique: true, index: true },
    scheduleId: { type: String, required: true, index: true },
    routeId: { type: String, required: true, index: true },
    vehicleId: { type: String, required: true, index: true },
    driverId: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    operatorId: { type: String, required: true, index: true },
    tenantId: { type: String, required: true, index: true },

    scheduledDepartureDate: { type: Date, required: true, index: true },
    scheduledDepartureTime: { type: String, required: true },
    actualDepartureTime: { type: Date },
    actualArrivalTime: { type: Date },

    status: {
        type: String,
        enum: Object.values(TripStatus),
        default: TripStatus.SCHEDULED,
        index: true
    },
    currentStopIndex: { type: Number, default: 0 },
    eta: { type: Date },

    totalSeats: { type: Number, required: true },
    availableSeats: { type: Number, required: true },
    bookedSeats: [{ type: String }],

    stops: [{
        stopId: String,
        branchId: String,
        name: String,
        location: {
            type: { type: String, enum: ['Point'] },
            coordinates: [Number]
        },
        sequence: Number,
        estimatedArrivalMinutes: Number
    }],

    passengers: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },

    createdBy: { type: String },
    notes: { type: String }
}, {
    timestamps: true
});

// Compound indexes for common queries
TripSchema.index({ scheduledDepartureDate: 1, status: 1 });
TripSchema.index({ routeId: 1, scheduledDepartureDate: 1 });
TripSchema.index({ branchId: 1, scheduledDepartureDate: 1 });
TripSchema.index({ scheduleId: 1, scheduledDepartureDate: 1 }, { unique: true }); // Prevent duplicate trips
TripSchema.index({ status: 1, routeId: 1 });

export const TripModel = model<ITrip>('Trip', TripSchema);
