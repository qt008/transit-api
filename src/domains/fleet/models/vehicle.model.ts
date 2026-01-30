import { Schema, model, Document } from 'mongoose';

export enum VehicleStatus {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
    IN_MAINTENANCE = 'IN_MAINTENANCE',
    ON_TRIP = 'ON_TRIP'
}

export interface IVehicle extends Document {
    vehicleId: string;
    operatorId: string;
    plateNumber: string;
    capacity: number;
    type: string; // 'BUS', 'MINI_BUS', 'SPRINTER'
    status: VehicleStatus;
    activeDriverId?: string;

    // Multi-route assignment
    assignedRoutes: string[]; // Array of routeIds
    currentRouteIndex: number; // Which route in the array is currently active

    // Geospatial tracking
    location: {
        type: string;
        coordinates: [number, number]; // [lng, lat]
    };
    heading: number;
    speed: number;
    lastLocationUpdate: Date;

    createdAt: Date;
    updatedAt: Date;
}

const VehicleSchema = new Schema({
    vehicleId: { type: String, required: true, unique: true },
    operatorId: { type: String, required: true, index: true },
    plateNumber: { type: String, required: true, unique: true },
    capacity: { type: Number, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: Object.values(VehicleStatus), default: VehicleStatus.INACTIVE },
    activeDriverId: { type: String, index: true },

    assignedRoutes: [{ type: String }],
    currentRouteIndex: { type: Number, default: 0 },

    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] }
    },
    heading: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    lastLocationUpdate: { type: Date }
}, {
    timestamps: true
});

// Geospatial index
VehicleSchema.index({ location: '2dsphere' });

export const VehicleModel = model<IVehicle>('Vehicle', VehicleSchema);
