import { UserModel, IUser, Role } from '../models/user.model';
import { TenantService } from './tenant.service';
import { canCreateRole } from '../../../shared/constants/permissions';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export interface CreateUserDto {
    email?: string;
    phone: string;
    password: string;
    firstName: string;
    lastName: string;
    role: Role;
    tenantId?: string;
    primaryBranchId?: string;
    branchIds?: string[];
}

export interface UpdateUserDto {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    role?: Role;
    primaryBranchId?: string;
    branchIds?: string[];
    mfaEnabled?: boolean;
}

export interface UserListFilters {
    tenantId?: string;
    role?: Role;
    branchId?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export class UserService {
    /**
     * Validate if creator can create a user with the specified role
     */
    static canCreateUserWithRole(creatorRole: Role, targetRole: Role): boolean {
        return canCreateRole(creatorRole, targetRole);
    }

    /**
     * Create a new user with proper validation
     */
    static async createUser(creatorUser: IUser, userData: CreateUserDto): Promise<IUser> {
        // Validate role permissions
        const creatorRole = creatorUser.roles[0];
        if (!this.canCreateUserWithRole(creatorRole, userData.role)) {
            throw new Error(`You do not have permission to create users with role: ${userData.role}`);
        }

        // Determine tenant
        let tenantId = userData.tenantId;
        if (creatorRole !== Role.SUPER_ADMIN) {
            // Non-super-admins can only create users in their own tenant
            tenantId = creatorUser.tenantId;
        }

        if (!tenantId) {
            throw new Error('Tenant ID is required');
        }

        // Validate tenant exists
        const tenantExists = await TenantService.getTenantById(tenantId);
        if (!tenantExists) {
            throw new Error('Tenant does not exist');
        }

        // Check for existing user with same email or phone
        if (userData.email) {
            const existingEmail = await UserModel.findOne({ email: userData.email });
            if (existingEmail) {
                throw new Error('Email already in use');
            }
        }

        const existingPhone = await UserModel.findOne({ phone: userData.phone });
        if (existingPhone) {
            throw new Error('Phone number already in use');
        }

        // Generate user ID
        const userId = uuidv4();

        // Hash password
        const passwordHash = await bcrypt.hash(userData.password, 10);

        // Create wallet account ID (placeholder - should integrate with wallet service)
        const walletAccountId = `wallet-${userId}`;

        // Create user
        const newUser = new UserModel({
            userId,
            tenantId,
            email: userData.email,
            phone: userData.phone,
            passwordHash,
            firstName: userData.firstName,
            lastName: userData.lastName,
            roles: [userData.role],
            mfaEnabled: false,
            walletAccountId,
            primaryBranchId: userData.primaryBranchId,
            branchIds: userData.branchIds || [],
        });

        await newUser.save();

        // Return user without password
        const userObject = newUser.toObject();
        delete (userObject as any).passwordHash;

        return userObject as IUser;
    }

    /**
     * Update an existing user
     */
    static async updateUser(
        requesterId: string,
        targetUserId: string,
        updates: UpdateUserDto
    ): Promise<IUser | null> {
        // Get requester and target user
        const [requester, targetUser] = await Promise.all([
            UserModel.findOne({ userId: requesterId }),
            UserModel.findOne({ userId: targetUserId }),
        ]);

        if (!requester) {
            throw new Error('Requester not found');
        }

        if (!targetUser) {
            throw new Error('User not found');
        }

        const requesterRole = requester.roles[0];

        // Super admins can update anyone
        // Operator admins can only update users in their tenant (except super admins)
        if (requesterRole !== Role.SUPER_ADMIN) {
            if (requester.tenantId !== targetUser.tenantId) {
                throw new Error('You can only update users in your organization');
            }

            if (targetUser.roles.includes(Role.SUPER_ADMIN)) {
                throw new Error('You cannot update super admin users');
            }
        }

        // If role is being changed, validate permission
        if (updates.role && updates.role !== targetUser.roles[0]) {
            if (!this.canCreateUserWithRole(requesterRole, updates.role)) {
                throw new Error(`You do not have permission to assign role: ${updates.role}`);
            }
        }

        // Check for email/phone conflicts if they're being updated
        if (updates.email && updates.email !== targetUser.email) {
            const existingEmail = await UserModel.findOne({
                email: updates.email,
                userId: { $ne: targetUserId },
            });
            if (existingEmail) {
                throw new Error('Email already in use');
            }
        }

        if (updates.phone && updates.phone !== targetUser.phone) {
            const existingPhone = await UserModel.findOne({
                phone: updates.phone,
                userId: { $ne: targetUserId },
            });
            if (existingPhone) {
                throw new Error('Phone number already in use');
            }
        }

        // Update user
        const updateData: any = {};
        if (updates.email !== undefined) updateData.email = updates.email;
        if (updates.phone !== undefined) updateData.phone = updates.phone;
        if (updates.firstName !== undefined) updateData.firstName = updates.firstName;
        if (updates.lastName !== undefined) updateData.lastName = updates.lastName;
        if (updates.role !== undefined) updateData.roles = [updates.role];
        if (updates.primaryBranchId !== undefined) updateData.primaryBranchId = updates.primaryBranchId;
        if (updates.branchIds !== undefined) updateData.branchIds = updates.branchIds;
        if (updates.mfaEnabled !== undefined) updateData.mfaEnabled = updates.mfaEnabled;

        const updatedUser = await UserModel.findOneAndUpdate(
            { userId: targetUserId },
            { $set: updateData },
            { new: true }
        ).select('-passwordHash');

        return updatedUser;
    }

    /**
     * List users with proper filtering based on requester's role
     */
    static async listUsers(requesterUser: IUser, filters: UserListFilters = {}) {
        const query: any = {};
        const requesterRole = requesterUser.roles[0];

        // Non-super-admins can only see users in their tenant
        if (requesterRole !== Role.SUPER_ADMIN) {
            query.tenantId = requesterUser.tenantId;
        } else if (filters.tenantId) {
            query.tenantId = filters.tenantId;
        }

        // Filter by role
        if (filters.role) {
            query.roles = filters.role;
        }

        // Filter by branch
        if (filters.branchId) {
            query.$or = [
                { primaryBranchId: filters.branchId },
                { branchIds: filters.branchId },
            ];
        }

        // Search by name, email, or phone
        if (filters.search) {
            const searchRegex = new RegExp(filters.search, 'i');
            query.$or = [
                { firstName: searchRegex },
                { lastName: searchRegex },
                { email: searchRegex },
                { phone: searchRegex },
            ];
        }

        // Pagination
        const page = filters.page || 1;
        const limit = filters.limit || 20;
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            UserModel.find(query)
                .select('-passwordHash -mfaSecret')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 }),
            UserModel.countDocuments(query),
        ]);

        return {
            data: users,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get user by ID
     */
    static async getUserById(userId: string): Promise<IUser | null> {
        return await UserModel.findOne({ userId }).select('-passwordHash -mfaSecret');
    }

    /**
     * Deactivate a user
     */
    static async deactivateUser(requesterId: string, targetUserId: string): Promise<boolean> {
        const [requester, targetUser] = await Promise.all([
            UserModel.findOne({ userId: requesterId }),
            UserModel.findOne({ userId: targetUserId }),
        ]);

        if (!requester) {
            throw new Error('Requester not found');
        }

        if (!targetUser) {
            throw new Error('User not found');
        }

        const requesterRole = requester.roles[0];

        // Validate permissions
        if (requesterRole !== Role.SUPER_ADMIN) {
            if (requester.tenantId !== targetUser.tenantId) {
                throw new Error('You can only deactivate users in your organization');
            }

            if (targetUser.roles.includes(Role.SUPER_ADMIN) || targetUser.roles.includes(Role.OPERATOR_ADMIN)) {
                throw new Error('You cannot deactivate admin users');
            }
        }

        // Cannot deactivate yourself
        if (requesterId === targetUserId) {
            throw new Error('You cannot deactivate your own account');
        }

        await UserModel.updateOne(
            { userId: targetUserId },
            { $set: { isActive: false, deactivatedAt: new Date() } }
        );

        return true;
    }

    /**
     * Reactivate a user
     */
    static async reactivateUser(requesterId: string, targetUserId: string): Promise<boolean> {
        const requester = await UserModel.findOne({ userId: requesterId });

        if (!requester) {
            throw new Error('Requester not found');
        }

        const requesterRole = requester.roles[0];

        // Only admins can reactivate
        if (![Role.SUPER_ADMIN, Role.OPERATOR_ADMIN].includes(requesterRole)) {
            throw new Error('Insufficient permissions');
        }

        await UserModel.updateOne(
            { userId: targetUserId },
            { $set: { isActive: true }, $unset: { deactivatedAt: 1 } }
        );

        return true;
    }

    /**
     * Reset user password (admin function)
     */
    static async resetUserPassword(
        requesterId: string,
        targetUserId: string,
        newPassword: string
    ): Promise<boolean> {
        const [requester, targetUser] = await Promise.all([
            UserModel.findOne({ userId: requesterId }),
            UserModel.findOne({ userId: targetUserId }),
        ]);

        if (!requester) {
            throw new Error('Requester not found');
        }

        if (!targetUser) {
            throw new Error('User not found');
        }

        const requesterRole = requester.roles[0];

        // Validate permissions
        if (requesterRole !== Role.SUPER_ADMIN) {
            if (requester.tenantId !== targetUser.tenantId) {
                throw new Error('You can only reset passwords for users in your organization');
            }
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(newPassword, 10);

        await UserModel.updateOne(
            { userId: targetUserId },
            { $set: { passwordHash } }
        );

        return true;
    }
}
