import { FastifyRequest, FastifyReply } from 'fastify';
import { UserModel } from '../models/user.model';
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
}
