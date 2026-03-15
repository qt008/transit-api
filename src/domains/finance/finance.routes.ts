import { FastifyInstance } from 'fastify';
import { SettlementController, CalculateSchema, ExecuteSchema } from './controllers/settlement.controller';
import { LedgerController } from './controllers/ledger.controller';
import { validateBody } from '../../shared/kernel/validate.middleware';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from '../identity/models/user.model';

const FINANCE_READERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.GOVERNMENT];
const FINANCE_WRITERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];
const SETTLEMENT_APPROVERS = [Role.SUPER_ADMIN]; // Fund disbursement: SUPER_ADMIN only

export async function financeRoutes(fastify: FastifyInstance) {

    // ── Read-only metrics (SUPER_ADMIN, OPERATOR_ADMIN, GOVERNMENT) ──────────
    fastify.get('/collection-summary', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, SettlementController.collectionSummary);

    fastify.get('/bus-revenue', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, SettlementController.busRevenue);

    fastify.get('/profit-and-loss', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, SettlementController.profitAndLoss);

    fastify.get('/growth-metrics', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, SettlementController.growthMetrics);

    // ── Ledger & Accounting views (SUPER_ADMIN, OPERATOR_ADMIN, GOVERNMENT) ──
    fastify.get('/ledger/entries', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, LedgerController.listEntries);

    fastify.get('/ledger/accounts', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, LedgerController.listAccounts);

    fastify.get('/ledger/trial-balance', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, LedgerController.trialBalance);

    fastify.get('/ledger/balance-sheet', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_READERS)]
    }, LedgerController.balanceSheet);

    // ── Settlement read (SUPER_ADMIN, OPERATOR_ADMIN) ────────────────────────
    fastify.get('/settlements', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_WRITERS)]
    }, SettlementController.list);

    fastify.get('/settlements/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_WRITERS)]
    }, SettlementController.getById);

    // ── Settlement actions ───────────────────────────────────────────────────
    fastify.post('/settlements/calculate', {
        preHandler: [fastify.authenticate, requireAnyRole(FINANCE_WRITERS), validateBody(CalculateSchema)]
    }, SettlementController.calculate);

    // Approve and execute are restricted to SUPER_ADMIN — financial control point
    fastify.post('/settlements/:id/approve', {
        preHandler: [fastify.authenticate, requireAnyRole(SETTLEMENT_APPROVERS)]
    }, SettlementController.approve);

    fastify.post('/settlements/:id/execute', {
        preHandler: [fastify.authenticate, requireAnyRole(SETTLEMENT_APPROVERS), validateBody(ExecuteSchema)]
    }, SettlementController.execute);
}
