import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import mongoSanitize from 'express-mongo-sanitize';

/**
 * Sanitizes request body, query params, and URL params to prevent NoSQL injection
 * Removes keys that start with $ or contain .
 */
export const sanitizationMiddleware = (
    req: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
) => {
    if (req.body) {
        req.body = mongoSanitize.sanitize(req.body as Record<string, unknown>);
    }

    if (req.query) {
        req.query = mongoSanitize.sanitize(req.query as Record<string, unknown>);
    }

    if (req.params) {
        req.params = mongoSanitize.sanitize(req.params as Record<string, unknown>);
    }

    done();
};

/**
 * XSS Protection: Sanitize HTML entities in strings
 */
export const xssProtection = (
    req: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
) => {
    const sanitizeValue = (value: any): any => {
        if (typeof value === 'string') {
            return value
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;')
                .replace(/\//g, '&#x2F;');
        }
        if (typeof value === 'object' && value !== null) {
            const sanitized: any = Array.isArray(value) ? [] : {};
            for (const key in value) {
                sanitized[key] = sanitizeValue(value[key]);
            }
            return sanitized;
        }
        return value;
    };

    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeValue(req.body);
    }

    done();
};
