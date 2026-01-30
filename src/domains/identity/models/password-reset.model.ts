import { Schema, model, Document } from 'mongoose';

export interface IPasswordReset extends Document {
    userId: string;
    token: string;
    expiresAt: Date;
    used: boolean;
    createdAt: Date;
}

const PasswordResetSchema = new Schema({
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    used: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Auto-delete expired tokens after 24 hours
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

export const PasswordResetModel = model<IPasswordReset>('PasswordReset', PasswordResetSchema);
