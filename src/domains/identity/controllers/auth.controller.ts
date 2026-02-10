import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../services/auth.service';
import { Role, UserModel } from '../models/user.model';
import { z } from 'zod';
import { AuditLogger, AuditAction } from '../../../shared/kernel/audit.logger';

const authService = new AuthService();

// Zod Schemas for Runtime Validation
const RegisterSchema = z.object({
    phone: z.string().min(10),
    password: z.string().min(6),
    firstName: z.string(),
    lastName: z.string(),
    // role and tenantName removed to prevent Privilege Escalation via mass assignment
});

const LoginSchema = z.object({
    emailOrPhone: z.string(),
    password: z.string()
});

export class AuthController {

    static async register(req: FastifyRequest, reply: FastifyReply) {
        // Explicitly only allow safe fields. Ignore 'role' and 'tenantName' from input to prevent privilege escalation.
        const { phone, password, firstName, lastName } = RegisterSchema.parse(req.body);

        try {
            // Force role to PASSENGER for public registration
            const user = await authService.registerUser({
                phone,
                password,
                firstName,
                lastName,
                role: Role.PASSENGER
            });

            // Audit logging
            AuditLogger.logAuth(AuditAction.USER_REGISTERED, user.userId, true, {
                phone,
                role: Role.PASSENGER,
                ipAddress: req.ip
            });

            // Send OTP immediately for verification
            await authService.sendLoginOTP(user.userId, user.phone);


            return reply.status(201).send({
                success: true,
                data: {
                    userId: user.userId,
                    walletAccountId: user.walletAccountId
                }
            });
        } catch (err: any) {
            AuditLogger.logAuth(AuditAction.USER_REGISTERED, 'unknown', false, {
                phone,
                error: err.message
            });
            return reply.status(400).send({ error: err.message });
        }
    }

    static async login(req: FastifyRequest, reply: FastifyReply) {
        const { emailOrPhone, password } = LoginSchema.parse(req.body);

        try {
            const result = await authService.login(emailOrPhone, password);

            AuditLogger.logAuth(AuditAction.USER_LOGIN, result.user.userId, true, {
                emailOrPhone,
                requiresOtp: result.requiresOtp,
                ipAddress: req.ip
            });

            // If 2FA required, send OTP
            if (result.requiresOtp) {
                await authService.sendLoginOTP(result.user.userId, result.user.phone);

                return reply.send({
                    success: true,
                    data: {
                        userId: result.user.userId,
                        requiresOtp: true,
                        message: 'OTP sent to your phone',
                    }
                });
            }

            // No 2FA - return tokens
            return reply.send({
                success: true,
                data: result
            });
        } catch (err: any) {
            AuditLogger.logAuth(AuditAction.USER_LOGIN, 'unknown', false, {
                emailOrPhone,
                ipAddress: req.ip,
                error: err.message
            });
            return reply.status(401).send({ error: err.message });
        }
    }

    static async me(req: FastifyRequest, reply: FastifyReply) {
        // req.user is populated by JWT middleware
        return reply.send({ user: req.user });
    }

    static async forgotPassword(req: FastifyRequest, reply: FastifyReply) {
        const { phoneOrEmail } = z.object({ phoneOrEmail: z.string() }).parse(req.body);

        try {
            const result = await authService.requestPasswordReset(phoneOrEmail);
            return reply.send({
                success: true,
                message: 'If account exists, reset instructions sent',
                ...(process.env.NODE_ENV !== 'production' && { token: result.token })
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    static async resetPassword(req: FastifyRequest, reply: FastifyReply) {
        const { token, newPassword } = z.object({
            token: z.string(),
            newPassword: z.string().min(8)
        }).parse(req.body);

        try {
            await authService.resetPassword(token, newPassword);
            return reply.send({
                success: true,
                message: 'Password reset successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    static async changePassword(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const userId = req.user.id;
        const { oldPassword, newPassword } = z.object({
            oldPassword: z.string(),
            newPassword: z.string().min(8)
        }).parse(req.body);

        try {
            await authService.changePassword(userId, oldPassword, newPassword);
            return reply.send({
                success: true,
                message: 'Password changed successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    static async verifyOTP(req: FastifyRequest, reply: FastifyReply) {
        const { userId, code } = z.object({
            userId: z.string(),
            code: z.string().length(6),
        }).parse(req.body);

        try {
            const result = await authService.verifyLoginOTP(userId, code);

            AuditLogger.logAuth(AuditAction.USER_LOGIN, userId, true, {
                method: 'OTP_VERIFIED',
                ipAddress: req.ip
            });

            return reply.send({
                success: true,
                data: result
            });
        } catch (err: any) {
            AuditLogger.logAuth(AuditAction.USER_LOGIN, userId, false, {
                method: 'OTP_FAILED',
                error: err.message,
                ipAddress: req.ip
            });
            return reply.status(400).send({ error: err.message });
        }
    }

    static async resendOTP(req: FastifyRequest, reply: FastifyReply) {
        const { userId } = z.object({ userId: z.string() }).parse(req.body);

        try {
            const user = await UserModel.findOne({ userId });
            if (!user) throw new Error('User not found');

            await authService.sendLoginOTP(userId, user.phone);

            AuditLogger.logAuth(AuditAction.USER_LOGIN, userId, true, {
                method: 'OTP_RESENT',
                ipAddress: req.ip
            });

            return reply.send({
                success: true,
                message: 'OTP resent successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    static async refresh(req: FastifyRequest, reply: FastifyReply) {
        const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);

        try {
            const result = await authService.refreshAccessToken(refreshToken);

            return reply.send({
                success: true,
                data: result
            });
        } catch (err: any) {
            return reply.status(401).send({ error: err.message });
        }
    }
}
