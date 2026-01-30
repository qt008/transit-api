import { FastifyRequest, FastifyReply } from 'fastify';
import { ScheduleModel } from '../models/schedule.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const CreateScheduleSchema = z.object({
    routeId: z.string(),
    vehicleId: z.string(),
    driverId: z.string(),
    operatorId: z.string(),
    departureTime: z.string().regex(/^\d{2}:\d{2}$/), // HH:MM
    frequency: z.number().default(0),
    daysOfWeek: z.array(z.number().min(0).max(6)),
    validFrom: z.string().transform(str => new Date(str)),
    validTo: z.string().transform(str => new Date(str))
});

export class ScheduleController {

    /**
     * POST /schedules - Create schedule
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateScheduleSchema.parse(req.body);

        try {
            const schedule = await ScheduleModel.create({
                scheduleId: `SCHED-${randomUUID()}`,
                ...body
            });

            return reply.status(201).send({ success: true, data: schedule });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /schedules?routeId=X - List schedules
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        const { routeId, vehicleId, operatorId } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = { isActive: true };
        if (routeId) filter.routeId = routeId;
        if (vehicleId) filter.vehicleId = vehicleId;
        if (operatorId) filter.operatorId = operatorId;

        const [schedules, total] = await Promise.all([
            ScheduleModel.find(filter)
                .sort({ departureTime: 1 })
                .skip(params.skip)
                .limit(params.limit),
            ScheduleModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(schedules, total, params));
    }

    /**
     * PATCH /schedules/:id - Update schedule
     */
    static async update(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const updates = req.body as any;

        const schedule = await ScheduleModel.findOneAndUpdate(
            { scheduleId: id },
            { $set: updates },
            { new: true }
        );

        if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

        return reply.send({ success: true, data: schedule });
    }

    /**
     * DELETE /schedules/:id - Cancel schedule
     */
    static async cancel(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        const schedule = await ScheduleModel.findOneAndUpdate(
            { scheduleId: id },
            { isActive: false },
            { new: true }
        );

        if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

        return reply.send({ success: true, message: 'Schedule cancelled' });
    }
}
