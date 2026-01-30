import pino from 'pino';
import { env } from '../../config/env';

/**
 * Audit logger for security-critical operations
 * Logs to separate audit trail for compliance
 */
const auditLogger = pino({
    level: 'info',
    transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    base: {
        service: 'transitghana-api',
        env: env.NODE_ENV
    }
});

export enum AuditAction {
    USER_REGISTERED = 'USER_REGISTERED',
    USER_LOGIN = 'USER_LOGIN',
    USER_LOGOUT = 'USER_LOGOUT',
    WALLET_TOPUP = 'WALLET_TOPUP',
    TICKET_PURCHASED = 'TICKET_PURCHASED',
    TICKET_VALIDATED = 'TICKET_VALIDATED',
    TRANSACTION_CREATED = 'TRANSACTION_CREATED',
    UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
    PERMISSION_DENIED = 'PERMISSION_DENIED'
}

interface AuditLogEntry {
    action: AuditAction;
    userId?: string;
    tenantId?: string;
    resourceId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
    success: boolean;
    errorMessage?: string;
}

export class AuditLogger {
    static log(entry: AuditLogEntry) {
        const logData = {
            timestamp: new Date().toISOString(),
            ...entry
        };

        if (entry.success) {
            auditLogger.info(logData, `[AUDIT] ${entry.action}`);
        } else {
            auditLogger.warn(logData, `[AUDIT FAIL] ${entry.action}`);
        }
    }

    static logAuth(action: AuditAction, userId: string, success: boolean, metadata?: Record<string, any>) {
        this.log({
            action,
            userId,
            success,
            metadata
        });
    }

    static logFinancial(action: AuditAction, userId: string, resourceId: string, metadata?: Record<string, any>) {
        this.log({
            action,
            userId,
            resourceId,
            success: true,
            metadata
        });
    }
}

export { auditLogger };
