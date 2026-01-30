import { FastifyRequest } from 'fastify';

export interface PaginationParams {
    page: number;
    limit: number;
    skip: number;
}

export interface PaginatedResponse<T> {
    success: true;
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
    };
}

/**
 * Parse pagination query parameters with defaults
 */
export function getPaginationParams(req: FastifyRequest): PaginationParams {
    const query = req.query as any;
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20)); // Max 100, default 20
    const skip = (page - 1) * limit;

    return { page, limit, skip };
}

/**
 * Create paginated response envelope
 */
export function createPaginatedResponse<T>(
    data: T[],
    total: number,
    params: PaginationParams
): PaginatedResponse<T> {
    const totalPages = Math.ceil(total / params.limit);

    return {
        success: true,
        data,
        pagination: {
            page: params.page,
            limit: params.limit,
            total,
            totalPages,
            hasNextPage: params.page < totalPages,
            hasPrevPage: params.page > 1
        }
    };
}
