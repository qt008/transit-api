import mongoose from 'mongoose';
import { env } from '../config/env';
import { UserModel, Role } from '../domains/identity/models/user.model';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const seed = async () => {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log('Connected to MongoDB for Seeding');

        const passwordHash = await bcrypt.hash('123456', 10);
        const DEFAULT_TENANT_ID = 'tenant-default-001';

        const rolesToSeed = [
            {
                role: Role.SUPER_ADMIN,
                email: 'superadmin@transitgh.com',
                firstName: 'Super',
                lastName: 'Admin',
                phone: '+233200000001'
            },
            {
                role: Role.OPERATOR_ADMIN,
                email: 'operator@transitgh.com',
                firstName: 'Operator',
                lastName: 'Admin',
                phone: '+233200000002'
            },
            {
                role: Role.DRIVER,
                email: 'driver@transitgh.com',
                firstName: 'John',
                lastName: 'Driver',
                phone: '+233200000003'
            },
            {
                role: Role.INSPECTOR,
                email: 'inspector@transitgh.com',
                firstName: 'Jane',
                lastName: 'Inspector',
                phone: '+233200000004'
            },
            {
                role: Role.PASSENGER,
                email: 'passenger@transitgh.com',
                firstName: 'Kwame',
                lastName: 'Passenger',
                phone: '+233200000005'
            },
            {
                role: Role.GOVERNMENT,
                email: 'govt@transitgh.com',
                firstName: 'Government',
                lastName: 'Official',
                phone: '+233200000006'
            }
        ];

        for (const user of rolesToSeed) {
            const existingUser = await UserModel.findOne({ email: user.email });
            if (!existingUser) {
                await UserModel.create({
                    userId: uuidv4(),
                    tenantId: DEFAULT_TENANT_ID,
                    email: user.email,
                    phone: user.phone,
                    passwordHash,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    roles: [user.role],
                    walletAccountId: `WALLET-${user.role}-${uuidv4().substring(0, 8)}`,
                    mfaEnabled: false
                });
                console.log(`Created user for role: ${user.role} (${user.email})`);
            } else {
                console.log(`User already exists for role: ${user.role} (${user.email})`);
            }
        }

        console.log('Seeding completed successfully');
        process.exit(0);
    } catch (err) {
        console.error('Seeding Failed:', err);
        process.exit(1);
    }
};

seed();
