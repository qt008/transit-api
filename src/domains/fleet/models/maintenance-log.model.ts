import mongoose, { Schema, Document } from 'mongoose';

export enum MaintenanceType {
    ROUTINE = 'ROUTINE',
    REPAIR = 'REPAIR',
    INSPECTION = 'INSPECTION',
    BREAKDOWN = 'BREAKDOWN',
    OTHER = 'OTHER'
}

export enum MaintenanceStatus {
    SCHEDULED = 'SCHEDULED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED'
}

export interface IMaintenanceLog extends Document {
    maintenanceId: string;
    tenantId: string;
    vehicleId: string;
    vehicleReg: string; // Snapshot for easier querying

    type: MaintenanceType;
    description: string;
    status: MaintenanceStatus;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

    // Scheduling & Execution
    scheduledDate: Date;
    startDate?: Date;
    completedDate?: Date;

    // Cost & Details
    cost: number;
    providerName?: string; // Workshop or Mechanic name
    odometerReading?: number; // Mileage at time of service

    notes?: string;
    attachments: string[]; // URLs

    performedBy?: string; // User ID of who logged/performed it

    createdAt: Date;
    updatedAt: Date;
}

const MaintenanceLogSchema = new Schema<IMaintenanceLog>(
    {
        maintenanceId: { type: String, required: true, unique: true, index: true },
        tenantId: { type: String, required: true, index: true },
        vehicleId: { type: String, required: true, index: true },
        vehicleReg: { type: String, required: true },

        type: { type: String, enum: Object.values(MaintenanceType), required: true },
        description: { type: String, required: true },
        status: { type: String, enum: Object.values(MaintenanceStatus), default: MaintenanceStatus.SCHEDULED, index: true },
        priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },

        scheduledDate: { type: Date, required: true, index: true },
        startDate: Date,
        completedDate: Date,

        cost: { type: Number, default: 0 },
        providerName: String,
        odometerReading: Number,

        notes: String,
        attachments: [String],

        performedBy: String
    },
    { timestamps: true }
);

// Indexes for common queries
MaintenanceLogSchema.index({ tenantId: 1, status: 1 });
MaintenanceLogSchema.index({ vehicleId: 1, scheduledDate: -1 });

export const MaintenanceLogModel = mongoose.model<IMaintenanceLog>('MaintenanceLog', MaintenanceLogSchema);
