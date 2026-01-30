import mongoose, { Schema, Document } from 'mongoose';

export enum AccountType {
    ASSET_PASSENGER_WALLET = '1100',      // User prepaid balance
    LIABILITY_OPERATOR_ESCROW = '2100',   // Held funds before settlement
    REVENUE_FARE = '4100',                // Completed trip revenue
    EXPENSE_COMMISSION = '5100',          // Platform fee
    ASSET_MOMO_CLEARING = '1200'          // Mobile Money pending
}

export interface IAccount extends Document {
    accountId: string;
    ownerId: string; // User or Operator ID
    type: AccountType;
    currency: string;
    balance: number; // Current snapshot (cached for read speed)
    isActive: boolean;
}

const AccountSchema = new Schema<IAccount>(
    {
        accountId: { type: String, required: true, unique: true, index: true },
        ownerId: { type: String, required: true, index: true },
        type: { type: String, enum: Object.values(AccountType), required: true },
        currency: { type: String, default: 'GHS' },
        balance: { type: Number, default: 0 }, // In Pesewas
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

export const AccountModel = mongoose.model<IAccount>('Account', AccountSchema);
