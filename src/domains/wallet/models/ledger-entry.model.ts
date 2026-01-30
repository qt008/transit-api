import mongoose, { Schema, Document } from 'mongoose';

export enum TransactionType {
    DEBIT = 'DEBIT',
    CREDIT = 'CREDIT'
}

export interface ILedgerEntry extends Document {
    transactionId: string; // Groups the double-entry pair
    accountId: string;
    amount: number; // Always positive
    type: TransactionType;
    balanceAfter: number; // Snapshot for reconciliation
    description: string;
    metadata: Record<string, any>;
    idempotencyKey?: string;
}

const LedgerEntrySchema = new Schema<ILedgerEntry>(
    {
        transactionId: { type: String, required: true, index: true },
        accountId: { type: String, required: true, index: true },
        amount: { type: Number, required: true, min: 0 },
        type: { type: String, enum: Object.values(TransactionType), required: true },
        balanceAfter: { type: Number, required: true },
        description: { type: String, required: true },
        metadata: { type: Schema.Types.Mixed, default: {} },
        idempotencyKey: { type: String, index: true, sparse: true }, // Sparse: unique only if present
    },
    { timestamps: true }
);

// Immutable: Prevent updates/deletes
LedgerEntrySchema.pre('updateOne', function (next) {
    next(new Error('Ledger entries are immutable'));
});
LedgerEntrySchema.pre('deleteOne', function (next) {
    next(new Error('Ledger entries are immutable'));
});

export const LedgerEntryModel = mongoose.model<ILedgerEntry>('LedgerEntry', LedgerEntrySchema);
