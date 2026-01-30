import { Schema, model, Document } from 'mongoose';

export enum TicketStatus {
    ISSUED = 'ISSUED',
    VALIDATED = 'VALIDATED',
    USED = 'USED',
    CANCELLED = 'CANCELLED',
    EXPIRED = 'EXPIRED'
}

export interface ITicket extends Document {
    ticketId: string;
    userId: string;
    routeId: string;
    tripId?: string;

    qrCode: string;
    price: number;

    secret: string;
    signature: string;
    expiresAt: Date;

    status: TicketStatus;

    validatedAt?: Date;
    validatedBy?: string;
    syncStatus: 'SYNCED' | 'PENDING';

    createdAt: Date;
    updatedAt: Date;
}

const TicketSchema = new Schema<ITicket>(
    {
        ticketId: { type: String, required: true, unique: true, index: true },
        userId: { type: String, required: true, index: true },
        routeId: { type: String, required: true },
        tripId: { type: String },

        qrCode: { type: String, required: true },
        price: { type: Number, required: true },

        secret: { type: String, required: true, select: false },
        signature: { type: String, required: true },
        expiresAt: { type: Date, required: true },

        status: {
            type: String,
            enum: Object.values(TicketStatus),
            default: TicketStatus.ISSUED
        },

        validatedAt: { type: Date },
        validatedBy: { type: String },
        syncStatus: { type: String, enum: ['SYNCED', 'PENDING'], default: 'SYNCED' }
    },
    { timestamps: true }
);

export const TicketModel = model<ITicket>('Ticket', TicketSchema);

