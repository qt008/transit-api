import mongoose, { Schema, Document } from 'mongoose';

export enum DriverStatus {
    ACTIVE = 'ACTIVE',
    ON_LEAVE = 'ON_LEAVE',
    SUSPENDED = 'SUSPENDED',
    INACTIVE = 'INACTIVE'
}

interface DriverDocument {
    documentType: 'LICENSE' | 'MEDICAL_CERT' | 'BACKGROUND_CHECK' | 'CONTRACT' | 'OTHER';
    documentNumber: string;
    issueDate: Date;
    expiryDate: Date;
    fileUrl?: string;
    fileName?: string;
    uploadedAt?: Date;
    status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
    notes?: string;
}

export interface IDriver extends Document {
    driverId: string;
    userId: string;              // Link to User model
    tenantId: string;
    baseBranchId?: string;       // Primary/Home branch

    // Personal Info
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    dateOfBirth: Date;
    address?: string;
    photoUrl?: string;

    // License Info
    licenseNumber: string;
    licenseClass: string;        // e.g., "C", "D", "CE"
    licenseIssueDate: Date;
    licenseExpiryDate: Date;
    licenseFileUrl?: string;

    // Status
    status: DriverStatus;

    // Documents
    documents: DriverDocument[];

    // Assignment
    currentVehicleId?: string;
    currentVehicleReg?: string;

    // Performance
    totalTrips: number;
    rating: number;              // 0-5

    // Emergency Contact
    emergencyContactName?: string;
    emergencyContactPhone?: string;

    createdAt: Date;
    updatedAt: Date;
}

const DriverSchema = new Schema<IDriver>(
    {
        driverId: { type: String, required: true, unique: true, index: true },
        userId: { type: String, required: true, index: true },
        tenantId: { type: String, required: true, index: true },
        baseBranchId: { type: String, index: true },

        firstName: { type: String, required: true },
        lastName: { type: String, required: true },
        phone: { type: String, required: true },
        email: String,
        dateOfBirth: { type: Date, required: true },
        address: String,
        photoUrl: String,

        licenseNumber: { type: String, required: true, unique: true },
        licenseClass: { type: String, required: true },
        licenseIssueDate: { type: Date, required: true },
        licenseExpiryDate: { type: Date, required: true },
        licenseFileUrl: String,

        status: { type: String, enum: Object.values(DriverStatus), default: DriverStatus.ACTIVE },

        documents: [{
            documentType: { type: String, required: true },
            documentNumber: { type: String, required: true },
            issueDate: { type: Date, required: true },
            expiryDate: { type: Date, required: true },
            fileUrl: String,
            fileName: String,
            uploadedAt: Date,
            status: { type: String, enum: ['VALID', 'EXPIRING_SOON', 'EXPIRED'], default: 'VALID' },
            notes: String
        }],

        currentVehicleId: String,
        currentVehicleReg: String,

        totalTrips: { type: Number, default: 0 },
        rating: { type: Number, default: 0, min: 0, max: 5 },

        emergencyContactName: String,
        emergencyContactPhone: String,
    },
    { timestamps: true }
);

DriverSchema.index({ 'documents.expiryDate': 1, 'documents.status': 1 });
DriverSchema.index({ licenseExpiryDate: 1 });

export const DriverModel = mongoose.model<IDriver>('Driver', DriverSchema);
