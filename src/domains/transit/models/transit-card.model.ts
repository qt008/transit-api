import { Schema, model, Document } from 'mongoose';

export enum TransitCardStatus {
    ACTIVE = 'ACTIVE',
    SUSPENDED = 'SUSPENDED',
    LOST = 'LOST',
    EXPIRED = 'EXPIRED'
}

export enum TransitCardType {
    PHYSICAL_NFC = 'PHYSICAL_NFC',   // Physical card issued to passenger
    VIRTUAL_HCE = 'VIRTUAL_HCE',     // Android Host Card Emulation (phone as card)
    QR_ONLY = 'QR_ONLY'              // No card — uses QR ticket flow only
}

export interface ITransitCard extends Document {
    cardId: string;
    cardUid: string;          // NFC/RFID hardware UID (hex string)
    userId: string;           // Linked passenger account
    walletAccountId: string;  // Linked wallet for fare deductions
    tenantId: string;

    type: TransitCardType;
    status: TransitCardStatus;

    // Card metadata
    cardNumber: string;       // Human-readable printed number (e.g. TG-0001-2345)
    issuedAt: Date;
    expiresAt: Date;

    // Usage tracking
    lastUsedAt?: Date;
    lastTripId?: string;
    totalTrips: number;
    totalSpent: number;       // In pesewas

    createdAt: Date;
    updatedAt: Date;
}

const TransitCardSchema = new Schema<ITransitCard>(
    {
        cardId: { type: String, required: true, unique: true, index: true },
        cardUid: { type: String, required: true, unique: true, index: true }, // UID must be globally unique
        userId: { type: String, required: true, index: true },
        walletAccountId: { type: String, required: true },
        tenantId: { type: String, required: true, index: true },

        type: {
            type: String,
            enum: Object.values(TransitCardType),
            default: TransitCardType.PHYSICAL_NFC
        },
        status: {
            type: String,
            enum: Object.values(TransitCardStatus),
            default: TransitCardStatus.ACTIVE
        },

        cardNumber: { type: String, required: true, unique: true },
        issuedAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },

        lastUsedAt: { type: Date },
        lastTripId: { type: String },
        totalTrips: { type: Number, default: 0 },
        totalSpent: { type: Number, default: 0 }
    },
    { timestamps: true }
);

TransitCardSchema.index({ userId: 1, status: 1 });

export const TransitCardModel = model<ITransitCard>('TransitCard', TransitCardSchema);
