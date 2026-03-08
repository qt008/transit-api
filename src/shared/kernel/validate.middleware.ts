/**
 * Reusable Zod validation middleware for Fastify routes.
 *
 * Usage in route definitions:
 *   fastify.post('/tap-on', {
 *       preHandler: [fastify.authenticate, validateBody(TapOnSchema)]
 *   }, TransitController.tapOn);
 *
 * On validation failure, returns 422 with structured field errors.
 * On success, the parsed (coerced + stripped) body replaces req.body.
 */
import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { ZodSchema, ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
    return (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const errors = formatZodErrors(result.error);
            reply.status(422).send({
                success: false,
                error: 'Validation failed',
                fields: errors
            });
            return;
        }
        // Replace body with the parsed (type-safe, stripped) version
        req.body = result.data as any;
        done();
    };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
    return (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            const errors = formatZodErrors(result.error);
            reply.status(422).send({
                success: false,
                error: 'Invalid query parameters',
                fields: errors
            });
            return;
        }
        req.query = result.data as any;
        done();
    };
}

export function validateParams<T>(schema: ZodSchema<T>) {
    return (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
        const result = schema.safeParse(req.params);
        if (!result.success) {
            const errors = formatZodErrors(result.error);
            reply.status(422).send({
                success: false,
                error: 'Invalid path parameters',
                fields: errors
            });
            return;
        }
        req.params = result.data as any;
        done();
    };
}

function formatZodErrors(error: ZodError): Record<string, string[]> {
    return error.errors.reduce<Record<string, string[]>>((acc, issue) => {
        const field = issue.path.join('.') || '_root';
        if (!acc[field]) acc[field] = [];
        acc[field].push(issue.message);
        return acc;
    }, {});
}
