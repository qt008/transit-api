import mongoose from 'mongoose';
import { env } from '../config/env';
import { cacheService } from '../shared/kernel/cache.service';

export const connectDatabase = async () => {
    try {
        mongoose.connection.on('connected', () => {
            console.log('MongoDB connected successfully');
        });

        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected');
        });

        await mongoose.connect(env.MONGO_URI, {
            autoIndex: env.NODE_ENV !== 'production',
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        // Initialize Redis cache
        await cacheService.connect();

    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
};

export const disconnectDatabase = async () => {
    await mongoose.disconnect();
    await cacheService.disconnect();
};
