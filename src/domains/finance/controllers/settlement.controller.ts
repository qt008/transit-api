import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SettlementService } from '../services/settlement.service';
import { SettlementModel, SettlementMethod, SettlementStatus } from '../models/settlement.model';

const settlementService = new SettlementService();

export const CalculateSchema = z.object({
    operatorId: z.string().min(1, 'operatorId is required'),
    periodStart: z.string().datetime({ message: 'periodStart must be a valid ISO datetime' }),
    periodEnd: z.string().datetime({ message: 'periodEnd must be a valid ISO datetime' }),
    platformFeeRate: z.number().min(0).max(1, 'platformFeeRate must be between 0 and 1').optional(),
    agentCommissionRate: z.number().min(0).max(1, 'agentCommissionRate must be between 0 and 1').optional()
}).refine(d => new Date(d.periodStart) < new Date(d.periodEnd), {
    message: 'periodStart must be before periodEnd',
    path: ['periodStart']
});

export const ExecuteSchema = z.object({
    method: z.enum(['MOMO', 'BANK_TRANSFER', 'WALLET_CREDIT'], {
        errorMap: () => ({ message: 'method must be MOMO, BANK_TRANSFER, or WALLET_CREDIT' })
    }),
    momoNumber: z.string().optional(),
    momoProvider: z.string().optional()
}).refine(d => d.method !== 'MOMO' || (!!d.momoNumber && !!d.momoProvider), {
    message: 'momoNumber and momoProvider are required when method is MOMO',
    path: ['momoNumber']
});

export class SettlementController {

    /**
     * POST /finance/settlements/calculate
     * Calculate a new settlement for an operator for a given period.
     */
    static async calculate(req: FastifyRequest, reply: FastifyReply) {
        const body = CalculateSchema.parse(req.body);
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        try {
            const settlement = await settlementService.calculateSettlement({
                operatorId: body.operatorId,
                tenantId,
                periodStart: new Date(body.periodStart),
                periodEnd: new Date(body.periodEnd),
                platformFeeRate: body.platformFeeRate,
                agentCommissionRate: body.agentCommissionRate
            });

            return reply.status(201).send({ success: true, data: settlement });
        } catch (err: any) {
            return reply.status(400).send({ success: false, error: err.message });
        }
    }

    /**
     * POST /finance/settlements/:id/approve
     * Stakeholder approves a settlement for payout.
     */
    static async approve(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        // @ts-ignore
        const approvedBy = req.user?.id;

        try {
            const settlement = await settlementService.approveSettlement(id, approvedBy);
            return reply.send({ success: true, data: settlement });
        } catch (err: any) {
            return reply.status(400).send({ success: false, error: err.message });
        }
    }

    /**
     * POST /finance/settlements/:id/execute
     * Execute (pay out) an approved settlement.
     */
    static async execute(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const body = ExecuteSchema.parse(req.body);

        try {
            const settlement = await settlementService.executeSettlement(
                id,
                body.method as SettlementMethod,
                { momoNumber: body.momoNumber, momoProvider: body.momoProvider }
            );
            return reply.send({ success: true, data: settlement });
        } catch (err: any) {
            return reply.status(400).send({ success: false, error: err.message });
        }
    }

    /**
     * GET /finance/settlements
     * List all settlements with filters.
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        const { operatorId, status, page = '1', limit = '20' } = req.query as any;
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        const filter: any = { tenantId };
        if (operatorId) filter.operatorId = operatorId;
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [settlements, total] = await Promise.all([
            SettlementModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            SettlementModel.countDocuments(filter)
        ]);

        return reply.send({
            success: true,
            data: settlements,
            meta: { total, page: parseInt(page), limit: parseInt(limit) }
        });
    }

    /**
     * GET /finance/settlements/:id
     * Single settlement with full line items.
     */
    static async getById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const settlement = await SettlementModel.findOne({ settlementId: id }).lean();
        if (!settlement) return reply.status(404).send({ success: false, error: 'Settlement not found' });
        return reply.send({ success: true, data: settlement });
    }

    /**
     * GET /finance/collection-summary?startDate=&endDate=&operatorId=
     * Aggregated collection across all channels for stakeholder dashboard.
     */
    static async collectionSummary(req: FastifyRequest, reply: FastifyReply) {
        const { startDate, endDate, operatorId } = req.query as any;
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        end.setUTCHours(23, 59, 59, 999);

        try {
            const summary = await settlementService.getCollectionSummary({
                tenantId,
                startDate: start,
                endDate: end,
                operatorId
            });
            return reply.send({ success: true, data: summary });
        } catch (err: any) {
            return reply.status(500).send({ success: false, error: err.message });
        }
    }

    /**
     * GET /finance/bus-revenue?startDate=&endDate=&operatorId=
     * Revenue per bus trip.
     */
    static async busRevenue(req: FastifyRequest, reply: FastifyReply) {
        const { startDate, endDate, operatorId } = req.query as any;
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        try {
            const data = await settlementService.getBusRevenue({
                tenantId,
                startDate: start,
                endDate: end,
                operatorId
            });
            return reply.send({ success: true, data });
        } catch (err: any) {
            return reply.status(500).send({ success: false, error: err.message });
        }
    }
}
