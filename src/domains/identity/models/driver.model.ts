import { Schema, model, Document } from 'mongoose';

export enum DriverStatus {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
    ON_TRIP = 'ON_TRIP',
    SUSPENDED = 'SUSPENDED'
}

export interface IDriver extends Document {
    driverId: string;
    userId: string; // Link to User in Identity domain
    operatorId: string; // Which transport company
    licenseNumber: string;
    licenseExpiry: Date;
    isActive: boolean;
    status: DriverStatus;
    rating: number; // 0-5
    totalTrips: number;
    assignedVehicleId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const DriverSchema = new Schema({
    driverId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, unique: true, index: true },
    operatorId: { type: String, required: true, index: true },
    licenseNumber: { type: String, required: true, unique: true },
    licenseExpiry: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: Object.values(DriverStatus), default: DriverStatus.ACTIVE },
    rating: { type: Number, default: 5, min: 0, max: 5 },
    totalTrips: { type: Number, default: 0 },
    assignedVehicleId: { type: String, index: true }
}, {
    timestamps: true
});

export const DriverModel = model<IDriver>('Driver', DriverSchema);
