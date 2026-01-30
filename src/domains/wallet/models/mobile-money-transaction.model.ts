import { Schema, model, Document } from 'mongoose';

export enum MobileMoneyProvider {
    MTN = 'MTN',
    VODAFONE = 'VODAFONE',
    AIRTELTIGO = 'AIRTELTIGO'
}

export enum TransactionStatus {
    PENDING = 'PENDING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED'
}

export enum TransactionType {
    TOPUP = 'TOPUP',
    WITHDRAW = 'WITHDRAW',
    TRANSFER = 'TRANSFER'
}

export interface IMobileMoneyTransaction extends Document {
    transactionId: string;
    userId: string;
    walletAccountId: string;

    type: TransactionType;
    provider: MobileMoneyProvider;
    phoneNumber: string;
    amount: number; // In pesewas

    status: TransactionStatus;

    // Provider details
    providerReference?: string; // From MTN/Vodafone
    providerTransactionId?: string;

    // For transfers
    recipientUserId?: string;
    recipientWalletId?: string;

    // Webhook tracking
    callbackReceived: boolean;
    callbackData?: any;

    createdAt: Date;
    updatedAt: Date;
}

const MobileMoneyTransactionSchema = new Schema({
    transactionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    walletAccountId: { type: String, required: true, index: true },

    type: { type: String, enum: Object.values(TransactionType), required: true },
    provider: { type: String, enum: Object.values(MobileMoneyProvider), required: true },
    phoneNumber: { type: String, required: true },
    amount: { type: Number, required: true },

    status: { type: String, enum: Object.values(TransactionStatus), default: TransactionStatus.PENDING },

    providerReference: { type: String },
    providerTransactionId: { type: String, index: true },

    recipientUserId: { type: String },
    recipientWalletId: { type: String },

    callbackReceived: { type: Boolean, default: false },
    callbackData: { type: Schema.Types.Mixed },
}, {
    timestamps: true
});

MobileMoneyTransactionSchema.index({ status: 1, createdAt: -1 });

export const MobileMoneyTransactionModel = model<IMobileMoneyTransaction>(
    'MobileMoneyTransaction',
    MobileMoneyTransactionSchema
);
