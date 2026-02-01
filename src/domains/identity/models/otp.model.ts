import mongoose, { Schema, Document } from 'mongoose';

export interface IOTP extends Document {
    userId: string;
    code: string;
    expiresAt: Date;
    verified: boolean;
    attempts: number;
}

const OTPSchema = new Schema<IOTP>(
    {
        userId: { type: String, required: true, index: true },
        code: { type: String, required: true },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 } // TTL index - auto-delete when expired
        },
        verified: { type: Boolean, default: false },
        attempts: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// Compound index for efficient OTP lookup
OTPSchema.index({ userId: 1, code: 1, verified: 1 });

export const OTPModel = mongoose.model<IOTP>('OTP', OTPSchema);
