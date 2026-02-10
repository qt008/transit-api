import { BranchModel, IBranch, BranchStatus } from '../models/branch.model';
import { BranchAssignmentModel, IBranchAssignment, AssignmentEntityType, AssignmentStatus } from '../models/branch-assignment.model';
import { v4 as uuidv4 } from 'uuid';

import { UserModel } from '../../identity/models/user.model';
import { VehicleModel } from '../../fleet/models/vehicle.model';

// Input type where coordinates are simple [lng, lat] array
type BranchInput = Omit<Partial<IBranch>, 'coordinates'> & {
    coordinates?: [number, number];
};

export class BranchService {
    // Validation
    static async validateManager(userId: string, tenantId: string) {
        return UserModel.findOne({ userId, tenantId });
    }

    // Branch CRUD
    static async createBranch(data: BranchInput, tenantId: string): Promise<IBranch> {
        let branchId = uuidv4();
        let isUnique = false;
        while (!isUnique) {
            const exists = await BranchModel.exists({ branchId });
            if (!exists) isUnique = true;
            else branchId = uuidv4();
        }

        const branch = await BranchModel.create({
            ...data,
            coordinates: {
                type: 'Point',
                coordinates: data.coordinates
            },
            branchId,
            tenantId
        });
        return branch;
    }

    static async getBranches(tenantId: string, filters: any = {}): Promise<IBranch[]> {
        const query: any = { tenantId };

        if (filters.status) query.status = filters.status;
        if (filters.type) query.type = filters.type;
        if (filters.search) {
            query.$or = [
                { name: { $regex: filters.search, $options: 'i' } },
                { code: { $regex: filters.search, $options: 'i' } }
            ];
        }

        return BranchModel.find(query).sort({ createdAt: -1 });
    }

    static async getBranchById(branchId: string, tenantId: string): Promise<IBranch | null> {
        return BranchModel.findOne({ branchId, tenantId });
    }

    static async updateBranch(branchId: string, data: BranchInput, tenantId: string): Promise<IBranch | null> {
        const updates: any = { ...data };

        if (data.coordinates) {
            updates.coordinates = {
                type: 'Point',
                coordinates: data.coordinates
            };
        }

        return BranchModel.findOneAndUpdate(
            { branchId, tenantId },
            { $set: updates },
            { new: true }
        );
    }

    static async deleteBranch(branchId: string, tenantId: string): Promise<boolean> {
        const result = await BranchModel.deleteOne({ branchId, tenantId });
        if (result.deletedCount > 0) {
            // Deactivate all assignments for this branch
            await BranchAssignmentModel.updateMany(
                { branchId, tenantId },
                { status: AssignmentStatus.INACTIVE }
            );
            return true;
        }
        return false;
    }

    // Assignment Management
    static async assignEntity(
        branchId: string,
        entityType: AssignmentEntityType,
        entityId: string,
        tenantId: string,
        assignedBy: string,
        isPrimary: boolean = false
    ): Promise<IBranchAssignment> {
        const assignmentId = uuidv4();

        // Validate Entity Existence
        switch (entityType) {
            case AssignmentEntityType.USER:
            case AssignmentEntityType.DRIVER:
                const userExists = await UserModel.exists({ userId: entityId });
                if (!userExists) throw new Error(`User/Driver with ID ${entityId} not found`);
                break;
            case AssignmentEntityType.VEHICLE:
                const vehicleExists = await VehicleModel.exists({ vehicleId: entityId });
                if (!vehicleExists) throw new Error(`Vehicle with ID ${entityId} not found`);
                break;
            default:
                // Optional: Throw error for unknown types or warn
                console.warn(`Skipping existence check for unknown entity type: ${entityType}`);
        }

        // Check if already assigned
        const existing = await BranchAssignmentModel.findOne({
            tenantId,
            branchId,
            entityType,
            entityId,
            status: AssignmentStatus.ACTIVE
        });

        // If setting as primary, unset other primaries for this entity
        if (isPrimary) {
            await BranchAssignmentModel.updateMany(
                { tenantId, entityType, entityId, status: AssignmentStatus.ACTIVE },
                { isPrimary: false }
            );
        }

        if (existing) {
            if (existing.isPrimary !== isPrimary) {
                existing.isPrimary = isPrimary;
                await existing.save();
            }
            return existing;
        }

        return BranchAssignmentModel.create({
            assignmentId,
            tenantId,
            branchId,
            entityType,
            entityId,
            isPrimary,
            assignedBy,
            status: AssignmentStatus.ACTIVE
        });
    }

    static async unassignEntity(
        branchId: string,
        entityType: AssignmentEntityType,
        entityId: string,
        tenantId: string
    ): Promise<boolean> {
        const result = await BranchAssignmentModel.updateOne(
            { tenantId, branchId, entityType, entityId },
            { status: AssignmentStatus.INACTIVE }
        );
        return result.modifiedCount > 0;
    }

    static async getEntityBranches(
        entityType: AssignmentEntityType,
        entityId: string,
        tenantId: string
    ): Promise<IBranchAssignment[]> {
        return BranchAssignmentModel.find({
            tenantId,
            entityType,
            entityId,
            status: AssignmentStatus.ACTIVE
        }).sort({ isPrimary: -1, createdAt: -1 });
    }

    static async getBranchEntities(
        branchId: string,
        entityType: AssignmentEntityType,
        tenantId: string
    ): Promise<IBranchAssignment[]> {
        return BranchAssignmentModel.find({
            tenantId,
            branchId,
            entityType,
            status: AssignmentStatus.ACTIVE
        });
    }

    // Geospatial
    static async getNearbyBranches(
        lat: number,
        lng: number,
        maxDistanceInMeters: number,
        tenantId: string
    ): Promise<IBranch[]> {
        return BranchModel.find({
            tenantId,
            status: BranchStatus.ACTIVE,
            coordinates: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    },
                    $maxDistance: maxDistanceInMeters
                }
            }
        });
    }
}
