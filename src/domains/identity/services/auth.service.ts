import { UserModel, Role, IUser } from '../models/user.model';
import { TenantModel, TenantType } from '../models/tenant.model';
import { WalletService } from '../../wallet/services/wallet.service';
import { AccountType } from '../../wallet/models/account.model';
import { PasswordResetModel } from '../models/password-reset.model';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';

// Mock ENV for now to ensure compilation if file missing
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev-refresh-secret';

interface RegisterRequest {
    phone: string;
    password: string;
    firstName: string;
    lastName: string;
    role?: Role; // Default PASSENGER
    tenantName?: string; // If creating a new tenant (e.g. Operator)
}

export class AuthService {
    private walletService: WalletService;

    constructor() {
        this.walletService = new WalletService();
    }

    async registerUser(req: RegisterRequest): Promise<IUser> {
        const { phone, password, firstName, lastName, role, tenantName } = req;

        // 1. Check Duplicates
        const existing = await UserModel.findOne({ phone });
        if (existing) throw new Error('User already exists');

        // 2. Resolve Tenant
        let tenantId = 'TENANT-CITIZEN'; // Default
        // Logic to create new tenant if Operator/Govt registration requested
        if (role === Role.OPERATOR_ADMIN || role === Role.GOVERNMENT) {
            tenantId = `TENANT-${randomUUID()}`;
            await TenantModel.create({
                tenantId,
                name: tenantName || 'Unknown Tenant',
                type: role === Role.OPERATOR_ADMIN ? TenantType.OPERATOR : TenantType.GOVERNMENT
            });
        }

        // 3. Create Wallet (Domain B Integration)
        // Passenger gets 'ASSET_PASSENGER_WALLET'
        // Operator gets 'LIABILITY_OPERATOR_ESCROW' (or distinct types)
        const walletType = role === Role.PASSENGER
            ? AccountType.ASSET_PASSENGER_WALLET
            : AccountType.LIABILITY_OPERATOR_ESCROW;

        // Determine Owner ID (Pre-generate user ID)
        const userId = `USER-${randomUUID()}`;
        const walletAccountId = await this.walletService.createAccount(userId, walletType);

        // 4. Create User
        const passwordHash = await bcrypt.hash(password, 12); // Cost 12
        const user = await UserModel.create({
            userId,
            tenantId,
            phone,
            passwordHash,
            firstName,
            lastName,
            roles: [role || Role.PASSENGER],
            walletAccountId
        });

        return user;
    }

    async login(emailOrPhone: string, password: string) {
        // Query by email OR phone
        const user = await UserModel.findOne({
            $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
        }).select('+passwordHash');

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            throw new Error('Invalid credentials');
        }

        // Generate Tokens
        const accessToken = jwt.sign(
            { id: user.userId, role: user.roles[0], tenantId: user.tenantId },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        const refreshToken = jwt.sign(
            { id: user.userId, version: 1 }, // Simple versioning for rotation
            REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        return { user, accessToken, refreshToken };
    }

    /**
     * Request password reset
     */
    async requestPasswordReset(phoneOrEmail: string): Promise<{ token: string }> {
        const user = await UserModel.findOne({
            $or: [{ phone: phoneOrEmail }, { email: phoneOrEmail }]
        });

        if (!user) {
            throw new Error('If account exists, reset instructions sent');
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour

        await PasswordResetModel.create({
            userId: user.userId,
            token,
            expiresAt
        });

        return { token };
    }

    /**
     * Reset password with token
     */
    async resetPassword(token: string, newPassword: string): Promise<void> {
        const resetRecord = await PasswordResetModel.findOne({
            token,
            used: false,
            expiresAt: { $gt: new Date() }
        });

        if (!resetRecord) {
            throw new Error('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await UserModel.updateOne(
            { userId: resetRecord.userId },
            { passwordHash }
        );

        resetRecord.used = true;
        await resetRecord.save();
    }

    /**
     * Change password (authenticated)
     */
    async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
        const user = await UserModel.findOne({ userId }).select('+passwordHash');
        if (!user) throw new Error('User not found');

        const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!isValid) throw new Error('Current password is incorrect');

        user.passwordHash = await bcrypt.hash(newPassword, 12);
        await user.save();
    }
}
