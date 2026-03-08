/**
 * migrate-tenant-ids.ts
 *
 * One-time safe migration script.
 *
 * Purpose:
 *   Ensures the two system Tenant documents exist, then finds all User records
 *   whose `tenantId` does not correspond to an existing Tenant document
 *   and assigns them the correct system tenant based on their role.
 *
 * Safety guarantees:
 *   - Zero records are deleted.
 *   - Only the `tenantId` field is written via `$set`.
 *   - Users whose `tenantId` already points to a valid, existing Tenant are untouched.
 *
 * Run:
 *   npx ts-node apps/api/src/scripts/migrate-tenant-ids.ts
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import { UserModel, Role } from '../domains/identity/models/user.model';
import { TenantService } from '../domains/identity/services/tenant.service';
import {
    PLATFORM_TENANT_ID,
    CITIZEN_TENANT_ID,
} from '../shared/constants/tenant.constants';

const migrate = async () => {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log('Connected to MongoDB for migration\n');

        // ── Step 1: Ensure system Tenant documents exist ─────────────────────────
        console.log('── Ensuring system tenants exist ──');
        await TenantService.getOrCreatePlatformTenant();
        await TenantService.getOrCreateCitizenTenant();
        console.log('System tenants verified ✓\n');

        // ── Step 2: Collect all existing valid tenantIds ──────────────────────────
        console.log('── Scanning existing Tenant collection ──');
        const { TenantModel } = await import('../domains/identity/models/tenant.model');
        const existingTenants = await TenantModel.find({}, { tenantId: 1 }).lean();
        const validTenantIds = new Set(existingTenants.map((t: any) => t.tenantId));
        console.log(`Found ${validTenantIds.size} valid tenant(s) in database`);

        // ── Step 3: Find users with orphaned tenantIds ────────────────────────────
        console.log('\n── Scanning User collection for orphaned tenantIds ──');
        const allUsers = await UserModel.find({}, { userId: 1, email: 1, phone: 1, roles: 1, tenantId: 1 }).lean();

        const orphanedUsers = allUsers.filter((u: any) => !validTenantIds.has(u.tenantId));

        if (orphanedUsers.length === 0) {
            console.log('No orphaned users found \u2014 all users already have valid tenantIds ✓');
            process.exit(0);
        }

        console.log(`Found ${orphanedUsers.length} user(s) with orphaned tenantIds:`);

        let updatedCount = 0;

        for (const user of orphanedUsers) {
            const primaryRole: Role = (user as any).roles?.[0] as Role;

            // Assign tenant by role:
            //  - PASSENGER → citizen tenant
            //  - everything else → platform tenant
            const newTenantId = primaryRole === Role.PASSENGER
                ? CITIZEN_TENANT_ID
                : PLATFORM_TENANT_ID;

            const result = await UserModel.updateOne(
                { userId: (user as any).userId },
                { $set: { tenantId: newTenantId } }
            );

            if (result.modifiedCount > 0) {
                updatedCount++;
                const identifier = (user as any).email || (user as any).phone || (user as any).userId;
                console.log(
                    `  🔄 ${identifier} (${primaryRole}) : '${(user as any).tenantId}' → '${newTenantId}'`
                );
            }
        }

        console.log(`\nMigration complete: ${updatedCount} user(s) updated ✓`);
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
};

migrate();
