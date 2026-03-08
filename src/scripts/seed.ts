import mongoose from 'mongoose';
import { env } from '../config/env';
import { UserModel, Role } from '../domains/identity/models/user.model';
import { TenantModel, TenantType } from '../domains/identity/models/tenant.model';
import {
    PLATFORM_TENANT_ID,
    PLATFORM_TENANT_NAME,
    CITIZEN_TENANT_ID,
    CITIZEN_TENANT_NAME,
} from '../shared/constants/tenant.constants';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const seed = async () => {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log('Connected to MongoDB for Seeding');

        // ────────────────────────────────────────────────────────────────────────────
        // STEP 1: Ensure system Tenant documents exist
        // ────────────────────────────────────────────────────────────────────────────

        console.log('\n── Seeding Tenant documents ──');

        // Platform tenant: owns SUPER_ADMIN, OPERATOR_ADMIN, DRIVER, INSPECTOR, GOVERNMENT seed users
        const platformTenant = await TenantModel.findOneAndUpdate(
            { tenantId: PLATFORM_TENANT_ID },
            {
                $setOnInsert: {
                    tenantId: PLATFORM_TENANT_ID,
                    name: PLATFORM_TENANT_NAME,
                    type: TenantType.OPERATOR,
                    isActive: true,
                },
            },
            { upsert: true, new: true }
        );
        console.log(`Platform tenant ready: ${PLATFORM_TENANT_ID} (${platformTenant.name})`);

        // Citizen tenant: shared by all PASSENGER users
        const citizenTenant = await TenantModel.findOneAndUpdate(
            { tenantId: CITIZEN_TENANT_ID },
            {
                $setOnInsert: {
                    tenantId: CITIZEN_TENANT_ID,
                    name: CITIZEN_TENANT_NAME,
                    type: TenantType.CITIZEN,
                    isActive: true,
                },
            },
            { upsert: true, new: true }
        );
        console.log(`Citizen tenant ready:   ${CITIZEN_TENANT_ID} (${citizenTenant.name})`);

        // ────────────────────────────────────────────────────────────────────────────
        // STEP 2: Seed users — create if missing, update tenantId if stale
        // ────────────────────────────────────────────────────────────────────────────

        console.log('\n── Seeding User accounts ──');

        const passwordHash = await bcrypt.hash('123456', 10);

        /**
         * Each entry declares:
         *  - role, email, phone, firstName, lastName: identity data
         *  - tenantId: the correct tenant this user belongs to
         */
        const usersToSeed = [
            {
                role: Role.SUPER_ADMIN,
                email: 'superadmin@transitgh.com',
                firstName: 'Super',
                lastName: 'Admin',
                phone: '+233200000001',
                tenantId: PLATFORM_TENANT_ID,
            },
            {
                role: Role.OPERATOR_ADMIN,
                email: 'operator@transitgh.com',
                firstName: 'Operator',
                lastName: 'Admin',
                phone: '+233200000002',
                tenantId: PLATFORM_TENANT_ID,
            },
            {
                role: Role.DRIVER,
                email: 'driver@transitgh.com',
                firstName: 'John',
                lastName: 'Driver',
                phone: '+233200000003',
                tenantId: PLATFORM_TENANT_ID,
            },
            {
                role: Role.INSPECTOR,
                email: 'inspector@transitgh.com',
                firstName: 'Jane',
                lastName: 'Inspector',
                phone: '+233200000004',
                tenantId: PLATFORM_TENANT_ID,
            },
            {
                role: Role.PASSENGER,
                email: 'passenger@transitgh.com',
                firstName: 'Kwame',
                lastName: 'Passenger',
                phone: '+233200000005',
                tenantId: CITIZEN_TENANT_ID,
            },
            {
                role: Role.GOVERNMENT,
                email: 'govt@transitgh.com',
                firstName: 'Government',
                lastName: 'Official',
                phone: '+233200000006',
                tenantId: PLATFORM_TENANT_ID,
            },
        ];

        for (const userData of usersToSeed) {
            const existingUser = await UserModel.findOne({ email: userData.email });

            if (!existingUser) {
                // Create the user fresh with the correct tenantId
                await UserModel.create({
                    userId: uuidv4(),
                    tenantId: userData.tenantId,
                    email: userData.email,
                    phone: userData.phone,
                    passwordHash,
                    firstName: userData.firstName,
                    lastName: userData.lastName,
                    roles: [userData.role],
                    walletAccountId: `WALLET-${userData.role}-${uuidv4().substring(0, 8)}`,
                    mfaEnabled: false,
                });
                console.log(`  ✅ Created: ${userData.role} (${userData.email}) → tenant: ${userData.tenantId}`);
            } else {
                // User exists — update tenantId if it is stale / mismatched
                if (existingUser.tenantId !== userData.tenantId) {
                    await UserModel.updateOne(
                        { email: userData.email },
                        { $set: { tenantId: userData.tenantId } }
                    );
                    console.log(`  🔄 Updated: ${userData.role} (${userData.email}) tenantId → ${userData.tenantId}`);
                } else {
                    console.log(`  ⏭  Skipped: ${userData.role} (${userData.email}) — already correct`);
                }
            }
        }

        console.log('\nSeeding completed successfully ✓');
        process.exit(0);
    } catch (err) {
        console.error('Seeding Failed:', err);
        process.exit(1);
    }
};

seed();
