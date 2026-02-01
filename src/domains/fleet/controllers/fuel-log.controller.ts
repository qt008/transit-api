import { FastifyRequest, FastifyReply } from 'fastify';
import { FuelLogModel, FuelTransactionType } from '../models/fuel-log.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const LogFuelSchema = z.object({
    vehicleId: z.string(),
    transactionType: z.nativeEnum(FuelTransactionType),
    quantity: z.number().positive(),
    pricePerLiter: z.number().positive(),
    totalCost: z.number().positive(),
    station: z.string().optional(),
    mileageAtTransaction: z.number().positive(),
    transactionDate: z.string().transform(str => new Date(str)),
    receiptUrl: z.string().optional(),
    notes: z.string().optional()
});

export class FuelLogController {
    /**
     * POST /fuel-logs - Log fuel transaction
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';
        // @ts-ignore
        const userId = req.user?.userId;
        // @ts-ignore
        const userName = req.user?.firstName ? `${req.user.firstName} ${req.user.lastName}` : 'Unknown';

        const body = LogFuelSchema.parse(req.body);

        // Calculate efficiency if previous log exists
        const lastLog = await FuelLogModel.findOne({ vehicleId: body.vehicleId })
            .sort({ transactionDate: -1 });

        let distanceCovered = 0;
        let fuelEfficiency = 0;

        if (lastLog && body.mileageAtTransaction > lastLog.mileageAtTransaction) {
            distanceCovered = body.mileageAtTransaction - lastLog.mileageAtTransaction;
            // Efficiency = Distance / Fuel Used (Assuming this fill-up replaces used fuel)
            fuelEfficiency = distanceCovered / body.quantity;
        }

        const log = await FuelLogModel.create({
            logId: `FUEL-${randomUUID()}`,
            tenantId,
            recordedBy: userId,
            recordedByName: userName,
            ...body,
            distanceCovered,
            fuelEfficiency
        });

        // Update vehicle mileage
        // await VehicleModel.updateOne({ vehicleId: body.vehicleId }, { currentMileage: body.mileageAtTransaction });

        return reply.status(201).send({ success: true, data: log });
    }

    /**
     * GET /fuel-logs - List logs
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        const { vehicleId, startDate, endDate } = req.query as any;
        const params = getPaginationParams(req);
        // @ts-ignore
        const tenantId = req.user?.tenantId;

        const filter: any = {};
        if (tenantId) filter.tenantId = tenantId;
        if (vehicleId) filter.vehicleId = vehicleId;
        if (startDate && endDate) {
            filter.transactionDate = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const [logs, total] = await Promise.all([
            FuelLogModel.find(filter)
                .sort({ transactionDate: -1 })
                .skip(params.skip)
                .limit(params.limit),
            FuelLogModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(logs, total, params));
    }

    /**
     * GET /fuel-logs/stats - Get fuel stats per vehicle
     */
    static async getStats(req: FastifyRequest, reply: FastifyReply) {
        const { vehicleId } = req.query as any;
        if (!vehicleId) return reply.status(400).send({ error: 'vehicleId is required' });

        const stats = await FuelLogModel.aggregate([
            { $match: { vehicleId } },
            {
                $group: {
                    _id: '$vehicleId',
                    totalCost: { $sum: '$totalCost' },
                    totalFuel: { $sum: '$quantity' },
                    avgEfficiency: { $avg: '$fuelEfficiency' },
                    count: { $sum: 1 }
                }
            }
        ]);

        return reply.send({ success: true, data: stats[0] || {} });
    }
}
