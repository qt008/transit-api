import { Schema, model, Document } from 'mongoose';

export enum TripStatus {
    SCHEDULED = 'SCHEDULED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED'
}

export interface ITrip extends Document {
    tripId: string;
    scheduleId?: string;
    routeId: string;
    vehicleId: string;
    driverId: string;
    operatorId: string;

    status: TripStatus;
    currentStopIndex: number;

    departureTime: Date;
    arrivalTime?: Date;
    eta?: Date;

    passengers: number;
    revenue: number;

    createdAt: Date;
    updatedAt: Date;
}

const TripSchema = new Schema({
    tripId: { type: String, required: true, unique: true },
    scheduleId: { type: String, index: true },
    routeId: { type: String, required: true, index: true },
    vehicleId: { type: String, required: true, index: true },
    driverId: { type: String, required: true, index: true },
    operatorId: { type: String, required: true, index: true },

    status: { type: String, enum: Object.values(TripStatus), default: TripStatus.SCHEDULED },
    currentStopIndex: { type: Number, default: 0 },

    departureTime: { type: Date },
    arrivalTime: { type: Date },
    eta: { type: Date },

    passengers: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
}, {
    timestamps: true
});

TripSchema.index({ status: 1, routeId: 1 });

export const TripModel = model<ITrip>('Trip', TripSchema);
