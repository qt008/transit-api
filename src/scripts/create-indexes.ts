import mongoose from 'mongoose';
import { env } from '../config/env'; import { UserModel } from '../domains/identity/models/user.model';
import { AccountModel } from '../domains/wallet/models/account.model';
import { LedgerEntryModel } from '../domains/wallet/models/ledger-entry.model';
import { TicketModel } from '../domains/ticketing/models/ticket.model';
import { VehicleModel } from '../domains/fleet/models/vehicle.model';
import { RouteModel } from '../domains/fleet/models/route.model';

/**
 * Creates and ensures all production indexes exist
 * Run this during deployments to optimize query performance
 */
async function ensureIndexes() {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log('Connected to MongoDB for index creation...');

        // Identity Indexes
        console.log('Creating Identity indexes...');
        await UserModel.collection.createIndex({ phone: 1 }, { unique: true });
        await UserModel.collection.createIndex({ email: 1 }, { unique: true, sparse: true });
        await UserModel.collection.createIndex({ tenantId: 1 });
        await UserModel.collection.createIndex({ roles: 1 });

        // Wallet Indexes
        console.log('Creating Wallet indexes...');
        await AccountModel.collection.createIndex({ accountId: 1 }, { unique: true });
        await AccountModel.collection.createIndex({ ownerId: 1 });
        await AccountModel.collection.createIndex({ type: 1 });

        await LedgerEntryModel.collection.createIndex({ transactionId: 1 });
        await LedgerEntryModel.collection.createIndex({ accountId: 1, createdAt: -1 }); // For transaction history queries
        await LedgerEntryModel.collection.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true });

        // Ticketing Indexes
        console.log('Creating Ticketing indexes...');
        await TicketModel.collection.createIndex({ ticketId: 1 }, { unique: true });
        await TicketModel.collection.createIndex({ passengerId: 1, createdAt: -1 });
        await TicketModel.collection.createIndex({ tripId: 1 });
        await TicketModel.collection.createIndex({ status: 1 });
        await TicketModel.collection.createIndex({ syncStatus: 1 });

        // Fleet Indexes (Geospatial)
        console.log('Creating Fleet indexes...');
        await VehicleModel.collection.createIndex({ 'location': '2dsphere' }); // Critical for $near queries
        await VehicleModel.collection.createIndex({ vehicleId: 1 }, { unique: true });
        await VehicleModel.collection.createIndex({ operatorId: 1 });
        await VehicleModel.collection.createIndex({ currentRouteId: 1 });
        await VehicleModel.collection.createIndex({ status: 1 });

        await RouteModel.collection.createIndex({ routeId: 1 }, { unique: true });
        await RouteModel.collection.createIndex({ operatorId: 1 });
        await RouteModel.collection.createIndex({ isActive: 1 });

        console.log('✅ All indexes created successfully');
        process.exit(0);

    } catch (error) {
        console.error('❌ Index creation failed:', error);
        process.exit(1);
    }
}

ensureIndexes();
