import { Schema, model, Document } from 'mongoose';
import { Role } from '../../identity/models/user.model';

export interface RouteStop {
    stopId: string;
    branchId: string;
    name: string;
    location: {
        type: string;
        coordinates: [number, number]; // [lng, lat]
    };
    sequence: number; // Order in route
    estimatedArrivalMinutes: number; // Minutes from route start
    price?: number; // Price from origin to this stop (in pesewas)
}

export interface RouteAccessControl {
    allowedRoles: Role[]; // Who can purchase tickets
    allowedOperators: string[]; // Specific operators (for bulk purchases)
    restrictedTenants: string[]; // Blocked tenants
}

export interface IRoute extends Document {
    routeId: string;
    name: string;
    operatorId: string;

    originBranchId: string;
    destinationBranchId: string;

    // Route path
    geometry: {
        type: string;
        coordinates: number[][]; // LineString [[lng, lat], ...]
    };

    // Stops
    stops: RouteStop[];

    // Schedule info
    basePrice: number; // In pesewas
    estimatedDuration: number; // Minutes
    isActive: boolean;

    // Access control
    accessControl: RouteAccessControl;

    createdAt: Date;
    updatedAt: Date;
}

const RouteStopSchema = new Schema({
    stopId: { type: String, required: true },
    branchId: { type: String, required: true },
    name: { type: String, required: true },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    sequence: { type: Number, required: true },
    estimatedArrivalMinutes: { type: Number, required: true },
    price: { type: Number } // Optional specific price
}, { _id: false });

const RouteSchema = new Schema({
    routeId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    operatorId: { type: String, required: true, index: true },

    originBranchId: { type: String, required: true, index: true },
    destinationBranchId: { type: String, required: true, index: true },

    geometry: {
        type: { type: String, enum: ['LineString'], default: 'LineString' },
        coordinates: { type: [[Number]], required: true }
    },

    stops: [RouteStopSchema],

    basePrice: { type: Number, required: true },
    estimatedDuration: { type: Number, required: true },
    isActive: { type: Boolean, default: true },

    accessControl: {
        allowedRoles: [{ type: String, enum: Object.values(Role) }],
        allowedOperators: [{ type: String }],
        restrictedTenants: [{ type: String }]
    }
}, {
    timestamps: true
});

// Geospatial index for route geometry
RouteSchema.index({ geometry: '2dsphere' });
RouteSchema.index({ isActive: 1 });

export const RouteModel = model<IRoute>('Route', RouteSchema);
