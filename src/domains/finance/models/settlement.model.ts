import { Schema, model, Document } from 'mongoose';

export enum SettlementStatus {
    PENDING = 'PENDING',       // Calculated, awaiting approval
    APPROVED = 'APPROVED',     // Stakeholder approved, ready to pay
    PROCESSING = 'PROCESSING', // Payout initiated via MoMo/bank
    COMPLETED = 'COMPLETED',   // Funds transferred to operator
    FAILED = 'FAILED',         // Payout failed — needs retry
    DISPUTED = 'DISPUTED'      // Operator raised a dispute
}

export enum SettlementMethod {
    MOMO = 'MOMO',
    BANK_TRANSFER = 'BANK_TRANSFER',
    WALLET_CREDIT = 'WALLET_CREDIT' // Credit internal operator wallet
}

export interface ISettlementLineItem {
    bookingId: string;
    tripId: string;
    fareAmount: number;      // In pesewas
    platformFee: number;     // Platform cut
    agentCommission: number; // POS agent cut (0 if not POS)
    netAmount: number;       // Operator receives: fareAmount - platformFee - agentCommission
    channel: string;         // bookingChannel
    settledAt: Date;
}

export interface ISettlement extends Document {
    settlementId: string;
    operatorId: string;
    tenantId: string;

    // Period
    periodStart: Date;
    periodEnd: Date;

    // Financials (all in pesewas)
    totalFareCollected: number;
    totalPlatformFees: number;
    totalAgentCommissions: number;
    totalNetPayable: number;   // What operator gets

    // Fee rates used (snapshot at time of settlement)
    platformFeeRate: number;   // e.g. 0.02 = 2%
    agentCommissionRate: number; // e.g. 0.01 = 1%

    // Line items
    lineItems: ISettlementLineItem[];
    bookingCount: number;

    // Payout
    status: SettlementStatus;
    payoutMethod?: SettlementMethod;
    payoutReference?: string; // PawaPay depositId or bank ref
    payoutInitiatedAt?: Date;
    payoutCompletedAt?: Date;
    payoutFailureReason?: string;

    // Operator payout details (snapshot)
    operatorMomoNumber?: string;
    operatorBankAccount?: string;

    // Approval
    approvedBy?: string;       // Stakeholder userId
    approvedAt?: Date;
    notes?: string;

    // Ledger reference
    walletTransactionId?: string;

    createdAt: Date;
    updatedAt: Date;
}

const LineItemSchema = new Schema<ISettlementLineItem>(
    {
        bookingId: { type: String, required: true },
        tripId: { type: String, required: true },
        fareAmount: { type: Number, required: true },
        platformFee: { type: Number, required: true },
        agentCommission: { type: Number, default: 0 },
        netAmount: { type: Number, required: true },
        channel: { type: String, required: true },
        settledAt: { type: Date, required: true }
    },
    { _id: false }
);

const SettlementSchema = new Schema<ISettlement>(
    {
        settlementId: { type: String, required: true, unique: true, index: true },
        operatorId: { type: String, required: true, index: true },
        tenantId: { type: String, required: true, index: true },

        periodStart: { type: Date, required: true },
        periodEnd: { type: Date, required: true },

        totalFareCollected: { type: Number, required: true },
        totalPlatformFees: { type: Number, required: true },
        totalAgentCommissions: { type: Number, default: 0 },
        totalNetPayable: { type: Number, required: true },

        platformFeeRate: { type: Number, required: true },
        agentCommissionRate: { type: Number, required: true },

        lineItems: [LineItemSchema],
        bookingCount: { type: Number, required: true },

        status: {
            type: String,
            enum: Object.values(SettlementStatus),
            default: SettlementStatus.PENDING,
            index: true
        },
        payoutMethod: { type: String, enum: Object.values(SettlementMethod) },
        payoutReference: { type: String },
        payoutInitiatedAt: { type: Date },
        payoutCompletedAt: { type: Date },
        payoutFailureReason: { type: String },

        operatorMomoNumber: { type: String },
        operatorBankAccount: { type: String },

        approvedBy: { type: String },
        approvedAt: { type: Date },
        notes: { type: String },

        walletTransactionId: { type: String }
    },
    { timestamps: true }
);

SettlementSchema.index({ operatorId: 1, status: 1 });
SettlementSchema.index({ periodStart: 1, periodEnd: 1, operatorId: 1 });

export const SettlementModel = model<ISettlement>('Settlement', SettlementSchema);
