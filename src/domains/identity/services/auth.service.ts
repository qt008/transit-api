import { UserModel, Role, IUser } from '../models/user.model';
import { TenantModel, TenantType } from '../models/tenant.model';
import { WalletService } from '../../wallet/services/wallet.service';
import { AccountType } from '../../wallet/models/account.model';
import { PasswordResetModel } from '../models/password-reset.model';
import { OTPModel } from '../models/otp.model';
import { SMSService } from '../../../services/sms.service';
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
    tenantId?: string; // Optional: Override default tenant (e.g. for Guest users)
}

export class AuthService {
    private walletService: WalletService;
    private smsService: SMSService;

    constructor() {
        this.walletService = new WalletService();
        this.smsService = new SMSService();
    }

    async registerUser(req: RegisterRequest): Promise<IUser> {
        const { phone, password, firstName, lastName, role, tenantName, tenantId: inputTenantId } = req;

        // 1. Check Duplicates
        const existing = await UserModel.findOne({ phone });
        if (existing) throw new Error('User already exists');

        // 2. Resolve Tenant
        let tenantId = inputTenantId || 'TENANT-CITIZEN'; // Use input or Default
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
        let userId = `USER-${randomUUID()}`;
        let isUnique = false;
        while (!isUnique) {
            const existingUser = await UserModel.exists({ userId });
            if (!existingUser) {
                isUnique = true;
            } else {
                userId = `USER-${randomUUID()}`;
            }
        }

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

    /**
     * Get or Create a Guest/Walk-in User
     * Used for POS bookings or Web Guest bookings
     */
    async getOrCreateGuestUser(phone: string, name: string, tenantId: string): Promise<string> {
        // 1. Check if user exists
        const existingUser = await UserModel.findOne({ phone });
        if (existingUser) {
            return existingUser.userId;
        }

        // 2. Create new guest user
        const names = name.split(' ');
        const firstName = names[0];
        const lastName = names.slice(1).join(' ') || 'Guest';

        // Generate random secure password (user won't know it, but can reset it later)
        const randomPassword = crypto.randomBytes(16).toString('hex');

        // Use registration flow to ensure all side effects (Wallet, etc.) happen
        // We assume Role.PASSENGER for guests
        const newUser = await this.registerUser({
            phone,
            password: randomPassword,
            firstName,
            lastName,
            role: Role.PASSENGER,
            tenantId
        });

        return newUser.userId;
    }

    async login(emailOrPhone: string, password: string) {
        // Query by email OR phone
        const user = await UserModel.findOne({
            $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
        }).select('+passwordHash');

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            throw new Error('Invalid credentials');
        }

        // ✅ Create sanitized user object - NO sensitive data
        const safeUser = {
            userId: user.userId,
            email: user.email,
            phone: user.phone,
            firstName: user.firstName,
            lastName: user.lastName,
            name: `${user.firstName} ${user.lastName}`,
            roles: user.roles,
            role: user.roles[0],
            tenantId: user.tenantId,
            mfaEnabled: user.mfaEnabled,
        };

        // If 2FA is enabled, don't return tokens yet
        if (user.mfaEnabled) {
            return {
                user: safeUser,
                requiresOtp: true,
                // No tokens - they'll get them after OTP verification
            };
        }

        // No 2FA - generate and return tokens
        const accessToken = jwt.sign(
            { id: user.userId, role: user.roles[0], tenantId: user.tenantId },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        const refreshToken = jwt.sign(
            { id: user.userId, version: 1 },
            REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        return { user: safeUser, accessToken, refreshToken, requiresOtp: false };
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

    /**
     * Generate and send OTP for login
     */
    async sendLoginOTP(userId: string, phone: string): Promise<void> {
        try {


            // Generate 6-digit code
            const code = crypto.randomInt(100000, 999999).toString();
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

            // Invalidate previous unverified OTPs
            await OTPModel.updateMany(
                { userId, verified: false },
                { verified: true }
            );

            // Create new OTP
            await OTPModel.create({
                userId,
                code,
                expiresAt,
                verified: false,
                attempts: 0,
            });

            // Send via SMS
            await this.smsService.sendOTP(phone, code);

        } catch (error) {
            console.log(error)
        }
    }

    /**
     * Verify OTP and return tokens
     */
    async verifyLoginOTP(userId: string, code: string) {
        const otp = await OTPModel.findOne({
            userId,
            code,
            verified: false,
            expiresAt: { $gt: new Date() },
        });

        if (!otp) {
            // Track failed attempts to prevent brute force
            await OTPModel.updateOne(
                { userId, code },
                { $inc: { attempts: 1 } }
            );
            throw new Error('Invalid or expired OTP');
        }

        // Check attempt limit (max 3 tries)
        if (otp.attempts >= 3) {
            otp.verified = true; // Invalidate
            await otp.save();
            throw new Error('Too many failed attempts. Request new OTP.');
        }

        // Mark as verified
        otp.verified = true;
        await otp.save();

        // Get user for token generation
        const user = await UserModel.findOne({ userId });
        if (!user) throw new Error('User not found');

        // Generate tokens
        const accessToken = jwt.sign(
            { id: user.userId, role: user.roles[0], tenantId: user.tenantId },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        const refreshToken = jwt.sign(
            { id: user.userId, version: 1 },
            REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        const safeUser = {
            userId: user.userId,
            email: user.email,
            phone: user.phone,
            firstName: user.firstName,
            lastName: user.lastName,
            name: `${user.firstName} ${user.lastName}`,
            roles: user.roles,
            role: user.roles[0],
            tenantId: user.tenantId,
        };

        return { user: safeUser, accessToken, refreshToken };
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken(refreshToken: string) {
        try {
            // Verify refresh token
            const decoded = jwt.verify(refreshToken, REFRESH_SECRET) as { id: string; version: number };

            // Get user
            const user = await UserModel.findOne({ userId: decoded.id });
            if (!user) {
                throw new Error('User not found');
            }

            // Generate new access token
            const accessToken = jwt.sign(
                { id: user.userId, role: user.roles[0], tenantId: user.tenantId },
                JWT_SECRET,
                { expiresIn: '15m' }
            );

            return { accessToken };
        } catch (error) {
            throw new Error('Invalid or expired refresh token');
        }
    }
}
