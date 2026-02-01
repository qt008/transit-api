import { Schema, model, Document } from 'mongoose';

export interface RouteFare {
    fromStopId: string;
    fromStopName: string;
    toStopId: string;
    toStopName: string;
    price: number; // In pesewas (Ghana's smallest currency unit)
    distance?: number; // Optional: distance in km
}

export interface FareRule {
    type: 'DISTANCE' | 'ZONE' | 'FLAT' | 'MATRIX';
    baseRate?: number; // For DISTANCE pricing
    perKmRate?: number; // For DISTANCE pricing
    zoneDefinitions?: {
        zoneId: string;
        stopIds: string[];
        intraCityPrice?: number;
    }[];
}

export interface IRoutePricing extends Document {
    routePricingId: string;
    routeId: string;
    tenantId: string; // For multi-tenant safety

    // Fare matrix: explicit stop-to-stop prices
    fares: RouteFare[];

    // Optional: Fare calculation rules (alternative to matrix)
    fareRule?: FareRule;

    // Version control for pricing changes
    version: number;
    effectiveFrom: Date;
    effectiveTo?: Date;
    isActive: boolean;

    // Metadata
    createdBy: string;
    notes?: string;

    createdAt: Date;
    updatedAt: Date;
}

const RouteFareSchema = new Schema({
    fromStopId: { type: String, required: true, index: true },
    fromStopName: { type: String, required: true },
    toStopId: { type: String, required: true, index: true },
    toStopName: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    distance: { type: Number }
}, { _id: false });

const FareRuleSchema = new Schema({
    type: {
        type: String,
        enum: ['DISTANCE', 'ZONE', 'FLAT', 'MATRIX'],
        required: true
    },
    baseRate: { type: Number },
    perKmRate: { type: Number },
    zoneDefinitions: [{
        zoneId: String,
        stopIds: [String],
        intraCityPrice: Number
    }]
}, { _id: false });

const RoutePricingSchema = new Schema({
    routePricingId: { type: String, required: true, unique: true, index: true },
    routeId: { type: String, required: true, index: true },
    tenantId: { type: String, required: true, index: true },

    fares: [RouteFareSchema],
    fareRule: FareRuleSchema,

    version: { type: Number, default: 1 },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    isActive: { type: Boolean, default: true },

    createdBy: { type: String, required: true },
    notes: { type: String },
}, {
    timestamps: true
});

// Compound index for finding active pricing
RoutePricingSchema.index({ routeId: 1, isActive: 1, effectiveFrom: -1 });

// Index for fare lookups
RoutePricingSchema.index({ 'fares.fromStopId': 1, 'fares.toStopId': 1 });

export const RoutePricingModel = model<IRoutePricing>('RoutePricing', RoutePricingSchema);
