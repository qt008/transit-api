import mongoose, { Schema, Document } from 'mongoose';

export enum TenantType {
    GOVERNMENT = 'GOVERNMENT',
    OPERATOR = 'OPERATOR',
    MERCHANT = 'MERCHANT',
    CITIZEN = 'CITIZEN' // Implicit tenant for normal users
}

export interface ITenant extends Document {
    tenantId: string;
    name: string;
    type: TenantType;
    config: Record<string, any>; // Generic config
    isActive: boolean;

    // Organization details
    logo?: string; // URL to logo image
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
}

const TenantSchema = new Schema<ITenant>(
    {
        tenantId: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true },
        type: { type: String, enum: Object.values(TenantType), required: true },
        config: { type: Schema.Types.Mixed, default: {} },
        isActive: { type: Boolean, default: true },

        // Organization details
        logo: { type: String },
        contactEmail: { type: String },
        contactPhone: { type: String },
        address: { type: String },
    },
    { timestamps: true }
);

export const TenantModel = mongoose.model<ITenant>('Tenant', TenantSchema);
