import mongoose, { Schema, model, Document } from 'mongoose';

export interface IMake {
    name: string;
    models: string[];
}

export interface IFleetConfig extends Document {
    tenantId: string;
    makes: IMake[];
    vehicleTypes: string[]; // e.g., 'MINI_BUS', 'SPRINTER'
    fuelTypes: string[];    // e.g., 'DIESEL', 'PETROL'
    colors: string[];       // e.g., 'White', 'Silver'
}

const FleetConfigSchema = new Schema<IFleetConfig>(
    {
        tenantId: { type: String, required: true, unique: true },
        makes: [{
            name: { type: String, required: true },
            models: [{ type: String }]
        }],
        vehicleTypes: [{ type: String }],
        fuelTypes: [{ type: String }],
        colors: [{ type: String }]
    },
    { timestamps: true }
);

// Prevent overwrite error in dev
export const FleetConfigModel = (mongoose.models.FleetConfig as mongoose.Model<IFleetConfig>) || model<IFleetConfig>('FleetConfig', FleetConfigSchema);
