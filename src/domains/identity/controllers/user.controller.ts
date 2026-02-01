import { FastifyRequest, FastifyReply } from 'fastify';
import { UserModel, Role } from '../models/user.model';
import { UserService, CreateUserDto, UpdateUserDto, UserListFilters } from '../services/user.service';
import { z } from 'zod';

const UpdateProfileSchema = z.object({
    name: z.string().min(2).optional(),
    phoneNumber: z.string().regex(/^0\d{9}$/).optional(),
    email: z.string().email().optional()
});

const UpdatePreferencesSchema = z.object({
    notifications: z.object({
        push: z.boolean().optional(),
        sms: z.boolean().optional(),
        email: z.boolean().optional()
    }).optional(),
    language: z.string().optional()
});

const CreateUserSchema = z.object({
    email: z.string().email().optional(),
    phone: z.string().min(10),
    password: z.string().min(8),
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    role: z.nativeEnum(Role),
    tenantId: z.string().optional(),
    primaryBranchId: z.string().optional(),
    branchIds: z.array(z.string()).optional(),
});

const UpdateUserSchema = z.object({
    email: z.string().email().optional(),
    phone: z.string().min(10).optional(),
    firstName: z.string().min(2).optional(),
    lastName: z.string().min(2).optional(),
    role: z.nativeEnum(Role).optional(),
    primaryBranchId: z.string().optional(),
    branchIds: z.array(z.string()).optional(),
    mfaEnabled: z.boolean().optional(),
});

const ResetPasswordSchema = z.object({
    newPassword: z.string().min(8),
});

export class UserController {

    /**
     * GET /users/me/profile - Get my profile
     */
    static async getProfile(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const userId = req.user.id;

        const user = await UserModel.findOne({ userId }).select('-password');
        if (!user) return reply.status(404).send({ error: 'User not found' });

        return reply.send({
            success: true,
            data: user
        });
    }

    /**
     * PATCH /users/me/profile - Update profile
     */
    static async updateProfile(req: FastifyRequest, reply: FastifyReply) {
        const updates = UpdateProfileSchema.parse(req.body);
        // @ts-ignore
        const userId = req.user.id;

        try {
            // Check  if email or phone already exists
            if (updates.email) {
                const existing = await UserModel.findOne({
                    email: updates.email,
                    userId: { $ne: userId }
                });
                if (existing) throw new Error('Email already in use');
            }

            if (updates.phoneNumber) {
                const existing = await UserModel.findOne({
                    phoneNumber: updates.phoneNumber,
                    userId: { $ne: userId }
                });
                if (existing) throw new Error('Phone number already in use');
            }

            const user = await UserModel.findOneAndUpdate(
                { userId },
                { $set: updates },
                { new: true }
            ).select('-password');

            return reply.send({
                success: true,
                data: user
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /users/me/photo - Upload profile photo (stub)
     */
    static async uploadPhoto(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const userId = req.user.id;

        // In production: Handle multipart/form-data, upload to S3/Cloudinary
        // For now: return mock URL
        const photoUrl = `https://storage.transitgh.com/users/${userId}/profile.jpg`;

        await UserModel.updateOne(
            { userId },
            { photoUrl }
        );

        return reply.send({
            success: true,
            data: { photoUrl }
        });
    }

    /**
     * PATCH /users/me/preferences - Update notification preferences
     */
    static async updatePreferences(req: FastifyRequest, reply: FastifyReply) {
        const preferences = UpdatePreferencesSchema.parse(req.body);
        // @ts-ignore
        const userId = req.user.id;

        await UserModel.updateOne(
            { userId },
            { $set: { preferences } }
        );

        return reply.send({
            success: true,
            message: 'Preferences updated'
        });
    }

    /**
     * DELETE /users/me - Delete account (GDPR)
     */
    static async deleteAccount(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const userId = req.user.id;

        // In production: Soft delete or anonymize data
        await UserModel.updateOne(
            { userId },
            {
                isActive: false,
                deletedAt: new Date()
            }
        );

        return reply.send({
            success: true,
            message: 'Account deleted successfully'
        });
    }

    // ========== ADMIN USER MANAGEMENT ENDPOINTS ==========

    /**
     * POST /users - Create new user (admin only)
     */
    static async createUser(req: FastifyRequest, reply: FastifyReply) {
        try {
            const userData = CreateUserSchema.parse(req.body);
            const requester = req.user as any;

            const requesterUser = await UserModel.findOne({ userId: requester.id });
            if (!requesterUser) {
                return reply.status(404).send({ error: 'Requester not found' });
            }

            const newUser = await UserService.createUser(requesterUser, userData as CreateUserDto);

            return reply.status(201).send({
                success: true,
                data: newUser,
                message: 'User created successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false,
                error: err.message
            });
        }
    }

    /**
     * GET /users - List all users (admin only)
     */
    static async listUsers(req: FastifyRequest, reply: FastifyReply) {
        try {
            const requester = req.user as any;
            const requesterUser = await UserModel.findOne({ userId: requester.id });

            if (!requesterUser) {
                return reply.status(404).send({ error: 'Requester not found' });
            }

            const query = req.query as any;
            const filters: UserListFilters = {
                tenantId: query.tenantId,
                role: query.role as Role,
                branchId: query.branchId,
                search: query.search,
                page: query.page ? parseInt(query.page) : 1,
                limit: query.limit ? parseInt(query.limit) : 20,
            };

            const result = await UserService.listUsers(requesterUser, filters);

            return reply.send({
                success: true,
                ...result
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false,
                error: err.message
            });
        }
    }

    /**
     * GET /users/:userId - Get user by ID (admin only)
     */
    static async getUserById(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { userId } = req.params as { userId: string };
            const requester = req.user as any;
            const requesterUser = await UserModel.findOne({ userId: requester.id });

            if (!requesterUser) {
                return reply.status(404).send({ error: 'Requester not found' });
            }

            const user = await UserService.getUserById(userId);

            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            // Check permissions - can only view users in same tenant unless super admin
            if (requesterUser.roles[0] !== Role.SUPER_ADMIN) {
                if (user.tenantId !== requesterUser.tenantId) {
                    return reply.status(403).send({
                        error: 'You can only view users in your organization'
                    });
                }
            }

            return reply.send({
                success: true,
                data: user
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false,
                error: err.message
            });
        }
    }

    /**
     * PATCH /users/:userId - Update user (admin only)
     */
    static async updateUser(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { userId } = req.params as { userId: string };
            const updates = UpdateUserSchema.parse(req.body);
            const requester = req.user as any;

            const updatedUser = await UserService.updateUser(
                requester.id,
                userId,
                updates as UpdateUserDto
            );

            if (!updatedUser) {
                return reply.status(404).send({ error: 'User not found' });
            }

            return reply.send({
                success: true,
                data: updatedUser,
                message: 'User updated successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false,
                error: err.message
            });
        }
    }

    /**
     * POST /users/:userId/deactivate - Deactivate user (admin only)
     */
    static async deactivateUser(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { userId } = req.params as { userId: string };
            const requester = req.user as any;

            await UserService.deactivateUser(requester.id, userId);

            return reply.send({
                success: true,
                message: 'User deactivated successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false,
                error: err.message
            });
        }
    }

    /**
     * POST /users/:userId/reactivate - Reactivate user (admin only)
     */
    static async reactivateUser(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { userId } = req.params as { userId: string };
            const requester = req.user as any;

            await UserService.reactivateUser(requester.id, userId);

            return reply.send({
                success: true,
                message: 'User reactivated successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false,
                error: err.message
            });
        }
    }

    /**
     * POST /users/:userId/reset-password - Reset user password (admin only)
     */
    static async resetUserPassword(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { userId } = req.params as { userId: string };
            const { newPassword } = ResetPasswordSchema.parse(req.body);
            const requester = req.user as any;

            await UserService.resetUserPassword(requester.id, userId, newPassword);

            return reply.send({
                success: true,
                message: 'Password reset successfully'
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false,
                error: err.message
            });
        }
    }
}
