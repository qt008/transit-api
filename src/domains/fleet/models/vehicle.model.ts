import mongoose, { Schema, Document } from 'mongoose';

export enum VehicleStatus {
    ACTIVE = 'ACTIVE',
    MAINTENANCE = 'MAINTENANCE',
    OUT_OF_SERVICE = 'OUT_OF_SERVICE',
    RETIRED = 'RETIRED'
}

export enum VehicleType {
    MINI_BUS = 'MINI_BUS',        // 12-18 seats
    STANDARD_BUS = 'STANDARD_BUS', // 30-40 seats
    LUXURY_COACH = 'LUXURY_COACH', // 40-60 seats
    SPRINTER = 'SPRINTER'          // 14-20 seats
}

export enum SeatType {
    STANDARD = 'STANDARD',
    VIP = 'VIP',
    WHEELCHAIR = 'WHEELCHAIR',
    RESERVED = 'RESERVED'
}

export interface SeatConfiguration {
    seatNumber: string;        // e.g., "1A", "2B"
    row: number;
    column: string;            // A, B, C, D, etc.
    type: SeatType;
    isAvailable: boolean;
    price?: number;            // Optional premium pricing
}

export interface SeatNode {
    id: string; // unique identifier e.g. "r0-c0"
    row: number;
    col: number;
    type: 'SEAT' | 'AISLE' | 'DRIVER' | 'EMPTY' | 'DOOR';
    label: string; // Display label "1", "A1"
    seatType: SeatType; // VIP, STANDARD
    isAvailable: boolean;
    price?: number;
}

export interface SeatLayout {
    totalRows: number;
    totalColumns: number;
    seats: SeatNode[];
}

interface VehicleDocument {
    documentType: 'INSURANCE' | 'ROADWORTHY' | 'REGISTRATION' | 'PERMIT' | 'OTHER';
    documentNumber: string;
    issueDate: Date;
    expiryDate: Date;
    fileUrl?: string;          // S3 URL
    fileName?: string;
    uploadedAt?: Date;
    status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
    notes?: string;
}

interface MaintenanceRecord {
    date: Date;
    type: 'ROUTINE' | 'REPAIR' | 'INSPECTION' | 'OTHER';
    description: string;
    cost: number;
    mileage: number;
    performedBy: string;
    nextServiceDue?: Date;
    nextServiceMileage?: number;
}

export interface IVehicle extends Document {
    vehicleId: string;
    tenantId: string;
    baseBranchId?: string; // Primary/Home branch

    // Basic Info
    registrationNumber: string;
    make: string;
    vehicleModel: string;
    year: number;
    color: string;
    vin?: string;                // Vehicle Identification Number
    plateNumber: string;         // Kept for backward compatibility/alias to registrationNumber

    // Type & Capacity
    type: VehicleType;
    totalSeats: number;
    seatConfiguration: SeatConfiguration[];
    seatLayout?: SeatLayout;
    capacity: number;            // Kept for backward compatibility/alias to totalSeats

    // Status
    status: VehicleStatus;
    isMaintenanceMode: boolean;
    maintenanceReason?: string;
    maintenanceStartDate?: Date;
    estimatedReturnDate?: Date;

    // Documents
    documents: VehicleDocument[];

    // Fuel Tracking
    currentMileage: number;
    fuelType: 'PETROL' | 'DIESEL' | 'ELECTRIC' | 'HYBRID';
    fuelCapacity: number;        // Liters
    averageFuelConsumption?: number; // km/L

    // Driver Assignment
    assignedDriverId?: string;
    assignedDriverName?: string;
    activeDriverId?: string;     // Kept for backward compatibility

    // Maintenance
    maintenanceHistory: MaintenanceRecord[];
    lastServiceDate?: Date;
    nextServiceDue?: Date;

    // Geospatial (Keep existing fields)
    location: {
        type: string;
        coordinates: [number, number]; // [lng, lat]
    };
    heading: number;
    speed: number;
    lastLocationUpdate: Date;

    // Route (Keep existing fields)
    assignedRoutes: string[];
    currentRouteIndex: number;

    operatorId: string; // Alias to tenantId for compatibility? Or separate? Assuming tenantId replaces operatorId or maps to it. Keeping operatorId for safety.

    createdAt: Date;
    updatedAt: Date;
}

const VehicleSchema = new Schema<IVehicle>(
    {
        vehicleId: { type: String, required: true, unique: true, index: true },
        tenantId: { type: String, required: true, index: true },
        baseBranchId: { type: String, index: true },
        operatorId: { type: String, index: true }, // Backward compat

        registrationNumber: { type: String, required: true, unique: true },
        plateNumber: { type: String }, // Backward compat
        make: { type: String, required: true },
        vehicleModel: { type: String, required: true },
        year: { type: Number, required: true },
        color: { type: String, required: true },
        vin: { type: String },

        type: { type: String, enum: Object.values(VehicleType), required: true },
        totalSeats: { type: Number, required: true },
        capacity: { type: Number }, // Backward compat

        seatConfiguration: [{
            seatNumber: String,
            row: Number,
            column: String,
            type: { type: String, enum: Object.values(SeatType), default: SeatType.STANDARD },
            isAvailable: { type: Boolean, default: true },
            price: Number
        }],

        seatLayout: {
            totalRows: Number,
            totalColumns: Number,
            seats: [{
                id: String,
                row: Number,
                col: Number,
                type: { type: String, enum: ['SEAT', 'AISLE', 'DRIVER', 'EMPTY', 'DOOR'], default: 'SEAT' },
                label: String,
                seatType: { type: String, enum: Object.values(SeatType), default: SeatType.STANDARD },
                isAvailable: { type: Boolean, default: true },
                price: Number
            }]
        },

        status: { type: String, enum: Object.values(VehicleStatus), default: VehicleStatus.ACTIVE },
        isMaintenanceMode: { type: Boolean, default: false },
        maintenanceReason: String,
        maintenanceStartDate: Date,
        estimatedReturnDate: Date,

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

        currentMileage: { type: Number, default: 0 },
        fuelType: { type: String, enum: ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID'], required: true },
        fuelCapacity: { type: Number, required: true },
        averageFuelConsumption: Number,

        assignedDriverId: String,
        assignedDriverName: String,
        activeDriverId: String, // Backward compat

        maintenanceHistory: [{
            date: { type: Date, required: true },
            type: { type: String, required: true },
            description: { type: String, required: true },
            cost: { type: Number, required: true },
            mileage: { type: Number, required: true },
            performedBy: String,
            nextServiceDue: Date,
            nextServiceMileage: Number
        }],
        lastServiceDate: Date,
        nextServiceDue: Date,

        // Existing fields maintained
        assignedRoutes: [{ type: String }],
        currentRouteIndex: { type: Number, default: 0 },

        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }
        },
        heading: { type: Number, default: 0 },
        speed: { type: Number, default: 0 },
        lastLocationUpdate: { type: Date }
    },
    { timestamps: true }
);

// Indexes
VehicleSchema.index({ 'documents.expiryDate': 1, 'documents.status': 1 });
VehicleSchema.index({ status: 1, isMaintenanceMode: 1 });
VehicleSchema.index({ location: '2dsphere' });

// @ts-ignore
export const VehicleModel = (mongoose.models.Vehicle as mongoose.Model<IVehicle>) || mongoose.model<IVehicle>('Vehicle', VehicleSchema);
