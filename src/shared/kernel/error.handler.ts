import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { env } from '../../config/env';

/**
 * Custom application error class with error codes
 */
export class AppError extends Error {
    constructor(
        public message: string,
        public statusCode: number = 500,
        public code: string = 'INTERNAL_ERROR',
        public isOperational: boolean = true
    ) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, public details?: any) {
        super(message, 400, 'VALIDATION_ERROR');
    }
}

export class AuthenticationError extends AppError {
    constructor(message: string = 'Authentication failed') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

export class AuthorizationError extends AppError {
    constructor(message: string = 'Insufficient permissions') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
    }
}

export class ConflictError extends AppError {
    constructor(message: string) {
        super(message, 409, 'CONFLICT');
    }
}

/**
 * Global error handler
 */
export const errorHandler = (
    error: FastifyError | AppError | ZodError | Error,
    request: FastifyRequest,
    reply: FastifyReply
) => {
    // Zod Validation Errors
    if (error instanceof ZodError) {
        return reply.status(400).send({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                details: error.errors.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }))
            }
        });
    }

    // Custom App Errors
    if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                ...(error instanceof ValidationError && { details: error.details })
            }
        });
    }

    // MongoDB Errors
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
        const mongoError = error as any;
        if (mongoError.code === 11000) {
            return reply.status(409).send({
                success: false,
                error: {
                    code: 'DUPLICATE_KEY',
                    message: 'Resource already exists'
                }
            });
        }
    }

    // Fastify Errors
    if ('statusCode' in error) {
        return reply.status(error.statusCode || 500).send({
            success: false,
            error: {
                code: error.code || 'FASTIFY_ERROR',
                message: error.message
            }
        });
    }

    // Unknown Errors - Log and hide details in production
    console.error('UNHANDLED ERROR:', error);

    return reply.status(500).send({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: env.NODE_ENV === 'production'
                ? 'An unexpected error occurred'
                : error.message,
            ...(env.NODE_ENV !== 'production' && { stack: error.stack })
        }
    });
};

/**
 * Async handler wrapper to catch promise rejections
 */
export const asyncHandler = (fn: Function) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            await fn(req, reply);
        } catch (error) {
            errorHandler(error as Error, req, reply);
        }
    };
};
