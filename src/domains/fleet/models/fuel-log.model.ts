import mongoose, { Schema, Document } from 'mongoose';

export enum FuelTransactionType {
    PURCHASE = 'PURCHASE',
    USAGE = 'USAGE',
    REFUND = 'REFUND'
}

export interface IFuelLog extends Document {
    logId: string;
    vehicleId: string;
    tenantId: string;

    transactionType: FuelTransactionType;

    // Purchase Details
    quantity: number;            // Liters
    pricePerLiter: number;
    totalCost: number;
    station?: string;
    receiptNumber?: string;
    receiptUrl?: string;         // S3 URL

    // Usage Details (calculated or manual)
    mileageAtTransaction: number;
    distanceCovered?: number;    // km since last fill
    fuelEfficiency?: number;     // km/L

    // Metadata
    recordedBy: string;          // User ID
    recordedByName: string;
    transactionDate: Date;
    notes?: string;

    createdAt: Date;
}

const FuelLogSchema = new Schema<IFuelLog>(
    {
        logId: { type: String, required: true, unique: true, index: true },
        vehicleId: { type: String, required: true, index: true },
        tenantId: { type: String, required: true, index: true },

        transactionType: { type: String, enum: Object.values(FuelTransactionType), required: true },

        quantity: { type: Number, required: true },
        pricePerLiter: { type: Number, required: true },
        totalCost: { type: Number, required: true },
        station: String,
        receiptNumber: String,
        receiptUrl: String,

        mileageAtTransaction: { type: Number, required: true },
        distanceCovered: Number,
        fuelEfficiency: Number,

        recordedBy: { type: String, required: true },
        recordedByName: { type: String, required: true },
        transactionDate: { type: Date, required: true },
        notes: String,
    },
    { timestamps: true }
);

FuelLogSchema.index({ vehicleId: 1, transactionDate: -1 });

// @ts-ignore
export const FuelLogModel = (mongoose.models.FuelLog as mongoose.Model<IFuelLog>) || mongoose.model<IFuelLog>('FuelLog', FuelLogSchema);
