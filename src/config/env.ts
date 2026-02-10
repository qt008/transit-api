import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('3005'),
    MONGO_URI: z.string().default('mongodb://localhost:27017/transitghana'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    JWT_SECRET: z.string().default('dev-secret'),
    REFRESH_SECRET: z.string().default('dev-refresh-secret'),
    CORS_ORIGIN: z.string().default('*'),
    // Arkesel SMS API
    ARKESEL_API_KEY: z.string().default(''),
    ARKESEL_SENDER_ID: z.string().default('TransitGH'),

    // AWS S3
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('transitghana-documents'),
});

export const env = envSchema.parse(process.env);
