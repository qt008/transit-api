import { TenantModel, ITenant } from '../models/tenant.model';

export class TenantService {
    /**
     * Get tenant by ID
     */
    static async getTenantById(tenantId: string): Promise<ITenant | null> {
        return TenantModel.findOne({ tenantId });
    }

    /**
     * Update tenant details
     */
    static async updateTenant(
        tenantId: string,
        updates: Partial<Omit<ITenant, 'tenantId' | 'type'>>
    ): Promise<ITenant | null> {
        return TenantModel.findOneAndUpdate(
            { tenantId },
            { $set: updates },
            { new: true }
        );
    }

    /**
     * Get all active tenants (for super admin use)
     */
    static async getAllTenants(): Promise<ITenant[]> {
        return TenantModel.find({ isActive: true });
    }

    /**
     * Create a new tenant
     */
    static async createTenant(data: {
        tenantId: string;
        name: string;
        type: string;
        logo?: string;
        contactEmail?: string;
        contactPhone?: string;
        address?: string;
    }): Promise<ITenant> {
        const tenant = new TenantModel(data);
        await tenant.save();
        return tenant;
    }

    /**
     * Check if tenant exists
     */
    static async tenantExists(tenantId: string): Promise<boolean> {
        const count = await TenantModel.countDocuments({ tenantId });
        return count > 0;
    }

    /**
     * Get or create default citizen tenant
     */
    static async getOrCreateDefaultTenant(): Promise<ITenant> {
        const defaultTenantId = 'TENANT-CITIZEN';

        let tenant = await TenantModel.findOne({ tenantId: defaultTenantId });

        if (!tenant) {
            tenant = await TenantModel.create({
                tenantId: defaultTenantId,
                name: 'Default Citizen Tenant',
                type: 'CITIZEN',
                isActive: true,
            });
        }

        return tenant;
    }
}
