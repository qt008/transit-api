import mongoose, { Schema, Document } from 'mongoose';

export enum AssignmentStatus {
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    REVOKED = 'REVOKED'
}

export interface IVehicleAssignment extends Document {
    assignmentId: string;
    tenantId: string;

    vehicleId: string;
    vehicleReg: string;

    driverId: string;
    driverName: string;

    status: AssignmentStatus;

    assignedAt: Date;
    assignedBy: string; // User ID
    startMileage: number;

    returnedAt?: Date;
    returnedBy?: string; // User ID
    endMileage?: number;

    notes?: string;

    createdAt: Date;
    updatedAt: Date;
}

const VehicleAssignmentSchema = new Schema<IVehicleAssignment>(
    {
        assignmentId: { type: String, required: true, unique: true, index: true },
        tenantId: { type: String, required: true, index: true },

        vehicleId: { type: String, required: true, index: true },
        vehicleReg: { type: String, required: true },

        driverId: { type: String, required: true, index: true },
        driverName: { type: String, required: true },

        status: { type: String, enum: Object.values(AssignmentStatus), default: AssignmentStatus.ACTIVE, index: true },

        assignedAt: { type: Date, required: true },
        assignedBy: { type: String, required: true },
        startMileage: { type: Number, required: true },

        returnedAt: Date,
        returnedBy: String,
        endMileage: Number,

        notes: String
    },
    { timestamps: true }
);

// Indexes
VehicleAssignmentSchema.index({ vehicleId: 1, status: 1 }); // Find active assignment for vehicle
VehicleAssignmentSchema.index({ driverId: 1, status: 1 }); // Find active assignment for driver

export const VehicleAssignmentModel = mongoose.model<IVehicleAssignment>('VehicleAssignment', VehicleAssignmentSchema);
