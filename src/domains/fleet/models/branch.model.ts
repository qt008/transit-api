import mongoose, { Schema, Document } from 'mongoose';

export enum BranchType {
    TERMINAL = 'TERMINAL',
    STOP = 'STOP'
}

export enum BranchStatus {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
    UNDER_MAINTENANCE = 'UNDER_MAINTENANCE'
}

export interface IBranch extends Document {
    branchId: string;
    tenantId: string;

    name: string;
    code: string;
    type: BranchType;

    // Location
    address: string;
    city: string;
    region: string;
    coordinates: {
        type: 'Point';
        coordinates: [number, number]; // [lng, lat]
    };

    // Contact
    phone?: string;
    email?: string;
    managerId?: string;
    managerName?: string;

    // Operational
    status: BranchStatus;
    operatingHours?: {
        open: string;   // "06:00"
        close: string;  // "22:00"
    };

    // Capacity
    parkingCapacity?: number;

    createdAt: Date;
    updatedAt: Date;
}

const BranchSchema = new Schema<IBranch>(
    {
        branchId: { type: String, required: true, unique: true, index: true },
        tenantId: { type: String, required: true, index: true },

        name: { type: String, required: true },
        code: { type: String, required: true },
        type: {
            type: String,
            enum: Object.values(BranchType),
            default: BranchType.TERMINAL
        },

        address: { type: String, required: true },
        city: { type: String, required: true },
        region: { type: String, required: true },
        coordinates: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], required: true } // [lng, lat]
        },

        phone: { type: String },
        email: { type: String },
        managerId: { type: String },
        managerName: { type: String },

        status: {
            type: String,
            enum: Object.values(BranchStatus),
            default: BranchStatus.ACTIVE
        },
        operatingHours: {
            open: { type: String },
            close: { type: String }
        },

        parkingCapacity: { type: Number }
    },
    { timestamps: true }
);

// Compound index for tenant scoping and searching
BranchSchema.index({ tenantId: 1, name: 1 });
BranchSchema.index({ tenantId: 1, code: 1 });

// Geospatial index for location queries
BranchSchema.index({ coordinates: '2dsphere' });

export const BranchModel = mongoose.model<IBranch>('Branch', BranchSchema);
