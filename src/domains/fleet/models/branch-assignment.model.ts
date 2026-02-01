import mongoose, { Schema, Document } from 'mongoose';

export enum AssignmentEntityType {
    DRIVER = 'DRIVER',
    VEHICLE = 'VEHICLE',
    USER = 'USER'
}

export enum AssignmentStatus {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE'
}

export interface IBranchAssignment extends Document {
    assignmentId: string;
    tenantId: string;

    branchId: string;

    entityType: AssignmentEntityType;
    entityId: string;

    isPrimary: boolean;

    assignedAt: Date;
    assignedBy: string;

    status: AssignmentStatus;

    createdAt: Date;
    updatedAt: Date;
}

const BranchAssignmentSchema = new Schema<IBranchAssignment>(
    {
        assignmentId: { type: String, required: true, unique: true, index: true },
        tenantId: { type: String, required: true, index: true },

        branchId: { type: String, required: true, index: true },

        entityType: {
            type: String,
            enum: Object.values(AssignmentEntityType),
            required: true
        },
        entityId: { type: String, required: true, index: true },

        isPrimary: { type: Boolean, default: false },

        assignedAt: { type: Date, default: Date.now },
        assignedBy: { type: String, required: true },

        status: {
            type: String,
            enum: Object.values(AssignmentStatus),
            default: AssignmentStatus.ACTIVE
        }
    },
    { timestamps: true }
);

// Compound index for quick lookup of entity assignments
BranchAssignmentSchema.index({ tenantId: 1, entityType: 1, entityId: 1, status: 1 });

// Compound index for finding all entities in a branch
BranchAssignmentSchema.index({ tenantId: 1, branchId: 1, entityType: 1, status: 1 });

// Ensure unique active primary assignment per entity (optional logic, but enforced here if needed)
// We allow multiple assignments, but only one primary generally. 
// However, business logic might change, so we won't strictly unique index isPrimary here yet.

export const BranchAssignmentModel = mongoose.model<IBranchAssignment>('BranchAssignment', BranchAssignmentSchema);
