import mongoose, { Schema, Document } from 'mongoose';

export enum Role {
    SUPER_ADMIN = 'SUPER_ADMIN',
    OPERATOR_ADMIN = 'OPERATOR_ADMIN',
    DRIVER = 'DRIVER',
    INSPECTOR = 'INSPECTOR',
    PASSENGER = 'PASSENGER',
    GOVERNMENT = 'GOVERNMENT'
}

export interface IUser extends Document {
    userId: string;
    tenantId: string; // Belongs to a specific tenant
    email?: string;
    phone: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    roles: Role[];
    mfaEnabled: boolean;
    mfaSecret?: string;
    walletAccountId: string; // Link to Domain B
}

const UserSchema = new Schema<IUser>(
    {
        userId: { type: String, required: true, unique: true, index: true },
        tenantId: { type: String, required: true, index: true },
        email: { type: String, unique: true, sparse: true },
        phone: { type: String, required: true, unique: true },
        passwordHash: { type: String, required: true, select: false },
        firstName: { type: String, required: true },
        lastName: { type: String, required: true },
        roles: {
            type: [String],
            enum: Object.values(Role),
            default: [Role.PASSENGER]
        },
        mfaEnabled: { type: Boolean, default: false },
        mfaSecret: { type: String, select: false },
        walletAccountId: { type: String, required: true }
    },
    { timestamps: true }
);

export const UserModel = mongoose.model<IUser>('User', UserSchema);
