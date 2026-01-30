import { createClient, RedisClientType } from 'redis';
import { env } from '../../config/env';

/**
 * Redis Cache Wrapper for performance optimization
 */
class CacheService {
    private client: RedisClientType | null = null;
    private isConnected = false;

    async connect() {
        if (this.isConnected) return;

        try {
            this.client = createClient({
                url: env.REDIS_URL
            });

            this.client.on('error', (err) => console.error('Redis Client Error', err));
            this.client.on('connect', () => console.log('Redis connected'));

            await this.client.connect();
            this.isConnected = true;
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            // App can continue without cache
        }
    }

    async get<T>(key: string): Promise<T | null> {
        if (!this.isConnected || !this.client) return null;

        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    }

    async set(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
        if (!this.isConnected || !this.client) return;

        try {
            await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
        } catch (error) {
            console.error('Cache set error:', error);
        }
    }

    async del(key: string): Promise<void> {
        if (!this.isConnected || !this.client) return;

        try {
            await this.client.del(key);
        } catch (error) {
            console.error('Cache del error:', error);
        }
    }

    async delPattern(pattern: string): Promise<void> {
        if (!this.isConnected || !this.client) return;

        try {
            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                await this.client.del(keys);
            }
        } catch (error) {
            console.error('Cache del pattern error:', error);
        }
    }

    /**
     * Cache wrapper for functions
     */
    async wrap<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlSeconds: number = 3600
    ): Promise<T> {
        // Try cache first
        const cached = await this.get<T>(key);
        if (cached !== null) return cached;

        // Fetch and cache
        const fresh = await fetchFn();
        await this.set(key, fresh, ttlSeconds);
        return fresh;
    }

    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.isConnected = false;
        }
    }
}

export const cacheService = new CacheService();
