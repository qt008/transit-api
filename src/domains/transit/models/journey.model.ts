import { Schema, model, Document } from 'mongoose';

export enum JourneyStatus {
    OPEN = 'OPEN',           // Tapped on, not yet tapped off
    CLOSED = 'CLOSED',       // Tapped off — fare settled
    ORPHANED = 'ORPHANED',   // No tap-off detected — max fare charged
    VOIDED = 'VOIDED'        // Manually voided by operator
}

export interface IFareBreakdown {
    baseFare: number;        // Fare from pricing matrix (pesewas)
    preAuthAmount: number;   // Amount held on tap-on
    finalCharge: number;     // Actual amount deducted on tap-off
    refundAmount: number;    // Refunded if preAuth > finalCharge (0 if orphaned)
}

export interface IJourney extends Document {
    journeyId: string;
    cardId: string;          // TransitCard.cardId
    cardUid: string;         // Denormalized for fast lookup
    userId: string;          // Passenger
    tripId: string;          // Bus trip the journey belongs to
    routeId: string;
    vehicleId: string;
    tenantId: string;

    // Boarding
    boardingStopId: string;
    boardingStopName: string;
    boardingStopSequence: number;
    boardedAt: Date;
    boardedByDeviceId: string; // Conductor device ID

    // Alighting
    alightingStopId?: string;
    alightingStopName?: string;
    alightingStopSequence?: number;
    alightedAt?: Date;
    alightedByDeviceId?: string;

    // Financials
    fare: IFareBreakdown;
    walletAccountId: string;
    transactionId?: string;  // Ledger transaction reference

    status: JourneyStatus;

    // Orphan handling
    orphanedReason?: string;
    orphanedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

const FareBreakdownSchema = new Schema<IFareBreakdown>(
    {
        baseFare: { type: Number, required: true },
        preAuthAmount: { type: Number, required: true },
        finalCharge: { type: Number, default: 0 },
        refundAmount: { type: Number, default: 0 }
    },
    { _id: false }
);

const JourneySchema = new Schema<IJourney>(
    {
        journeyId: { type: String, required: true, unique: true, index: true },
        cardId: { type: String, required: true, index: true },
        cardUid: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        tripId: { type: String, required: true, index: true },
        routeId: { type: String, required: true },
        vehicleId: { type: String, required: true },
        tenantId: { type: String, required: true, index: true },

        boardingStopId: { type: String, required: true },
        boardingStopName: { type: String, required: true },
        boardingStopSequence: { type: Number, required: true },
        boardedAt: { type: Date, required: true },
        boardedByDeviceId: { type: String, required: true },

        alightingStopId: { type: String },
        alightingStopName: { type: String },
        alightingStopSequence: { type: Number },
        alightedAt: { type: Date },
        alightedByDeviceId: { type: String },

        fare: { type: FareBreakdownSchema, required: true },
        walletAccountId: { type: String, required: true },
        transactionId: { type: String },

        status: {
            type: String,
            enum: Object.values(JourneyStatus),
            default: JourneyStatus.OPEN,
            index: true
        },

        orphanedReason: { type: String },
        orphanedAt: { type: Date }
    },
    { timestamps: true }
);

// Fast lookup: find open journey for a card
JourneySchema.index({ cardId: 1, status: 1 });
// Trip-level stats aggregation
JourneySchema.index({ tripId: 1, status: 1 });
// Orphan sweeper query
JourneySchema.index({ status: 1, boardedAt: 1 });

export const JourneyModel = model<IJourney>('Journey', JourneySchema);
