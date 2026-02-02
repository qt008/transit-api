import { FastifyRequest, FastifyReply } from 'fastify';
import { MaintenanceLogModel, MaintenanceStatus } from '../models/maintenance-log.model';
import { VehicleModel, VehicleStatus } from '../models/vehicle.model';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const createMaintenanceSchema = z.object({
    vehicleId: z.string(),
    type: z.enum(['ROUTINE', 'REPAIR', 'INSPECTION', 'BREAKDOWN', 'OTHER']),
    description: z.string().min(3),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    scheduledDate: z.string().datetime(),
    providerName: z.string().nullable().optional(),
    cost: z.number().min(0).nullable().optional(),
    notes: z.string().nullable().optional()
});

const updateMaintenanceSchema = z.object({
    status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    cost: z.number().min(0).nullable().optional(),
    completedDate: z.string().datetime().optional(),
    odometerReading: z.number().optional(),
    notes: z.string().nullable().optional(),
    providerName: z.string().nullable().optional()
});

export class MaintenanceController {

    static async create(req: FastifyRequest, reply: FastifyReply) {
        try {
            const tenantId = req.user?.tenantId;
            const data = createMaintenanceSchema.parse(req.body);

            // Verify vehicle exists
            const vehicle = await VehicleModel.findOne({
                vehicleId: data.vehicleId,
                tenantId
            });

            if (!vehicle) {
                return reply.status(404).send({ error: 'Vehicle not found' });
            }

            const maintenanceId = `MAINT-${randomUUID()}`;

            const log = await MaintenanceLogModel.create({
                maintenanceId,
                tenantId,
                // vehicleId is in ...data
                vehicleReg: vehicle.registrationNumber,
                ...data,
                status: MaintenanceStatus.SCHEDULED,
                performedBy: req.user?.id
            });

            // If priority is CRITICAL or status is IN_PROGRESS (if we allowed setting it directly), 
            // we might auto-set vehicle to MAINTENANCE mode. 
            // For now, we keep it decoupled unless explicit.

            return reply.status(201).send(log);
        } catch (error: any) {
            console.error('Create Maintenance Error:', error);
            return reply.status(400).send({ error: error.errors || error.message });
        }
    }

    static async list(req: FastifyRequest, reply: FastifyReply) {
        try {
            const tenantId = req.user?.tenantId;
            const { vehicleId, status, startDate, endDate } = req.query as { vehicleId?: string; status?: string; startDate?: string; endDate?: string };

            const query: any = { tenantId };

            if (vehicleId) query.vehicleId = vehicleId;
            if (status) query.status = status;

            if (startDate || endDate) {
                query.scheduledDate = {};
                if (startDate) query.scheduledDate.$gte = new Date(startDate);
                if (endDate) query.scheduledDate.$lte = new Date(endDate);
            }

            const logs = await MaintenanceLogModel.find(query)
                .sort({ scheduledDate: -1 })
                .limit(100);

            return reply.send({ data: logs });
        } catch (error) {
            return reply.status(500).send({ error: 'Failed to fetch maintenance logs' });
        }
    }

    static async update(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { id } = req.params as { id: string };
            const tenantId = req.user?.tenantId;
            const updates = updateMaintenanceSchema.parse(req.body);

            const log = await MaintenanceLogModel.findOne({ maintenanceId: id, tenantId });
            if (!log) {
                return reply.status(404).send({ error: 'Maintenance log not found' });
            }

            if (log.status === MaintenanceStatus.COMPLETED) {
                return reply.status(400).send({ error: 'Cannot edit a completed maintenance record' });
            }

            Object.assign(log, updates);

            // Special handling for completion
            if (updates.status === MaintenanceStatus.COMPLETED && !log.completedDate) {
                log.completedDate = new Date();

                // If odometer provided, update vehicle mileage?
                if (updates.odometerReading) {
                    await VehicleModel.updateOne(
                        { vehicleId: log.vehicleId },
                        { $max: { currentMileage: updates.odometerReading } }
                    );
                }

                // If vehicle was in MAINTENANCE mode, potentially release it?
                // For safety, we let the user explicitely release the vehicle via VehicleController,
                // OR we can do it here if requested.
                // Current approach: Just update the log.
            }

            await log.save();
            return reply.send(log);
        } catch (error: any) {
            return reply.status(400).send({ error: error.errors || error.message });
        }
    }

    static async getStats(req: FastifyRequest, reply: FastifyReply) {
        try {
            const tenantId = req.user?.tenantId;

            // Total Cost this month
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const stats = await MaintenanceLogModel.aggregate([
                { $match: { tenantId } },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        avgCost: { $avg: '$cost' },
                        count: { $sum: 1 },
                        pendingCount: {
                            $sum: {
                                $cond: [{ $in: ['$status', ['SCHEDULED', 'IN_PROGRESS']] }, 1, 0]
                            }
                        },
                        monthlyCost: {
                            $sum: {
                                $cond: [{ $gte: ['$scheduledDate', startOfMonth] }, '$cost', 0]
                            }
                        }
                    }
                }
            ]);

            return reply.send(stats[0] || { totalCost: 0, pendingCount: 0 });
        } catch (error) {
            return reply.status(500).send({ error: 'Failed to get stats' });
        }
    }
}
