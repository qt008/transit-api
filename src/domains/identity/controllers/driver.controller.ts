import { FastifyRequest, FastifyReply } from 'fastify';
import { DriverModel, DriverStatus } from '../models/driver.model';
import { UserModel, Role } from '../models/user.model';
import { VehicleModel } from '../../fleet/models/vehicle.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const CreateDriverSchema = z.object({
    userId: z.string(),
    operatorId: z.string(),
    licenseNumber: z.string(),
    licenseExpiry: z.string().transform(str => new Date(str))
});

const UpdateDriverSchema = z.object({
    licenseNumber: z.string().optional(),
    licenseExpiry: z.string().transform(str => new Date(str)).optional(),
    isActive: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ON_TRIP', 'SUSPENDED']).optional()
});

export class DriverController {

    /**
     * POST /drivers - Create new driver
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateDriverSchema.parse(req.body);

        try {
            // Verify user exists and has DRIVER role
            const user = await UserModel.findOne({ userId: body.userId });
            if (!user) throw new Error('User not found');
            if (!user.roles.includes(Role.DRIVER)) {
                throw new Error('User must have DRIVER role');
            }

            // Check if driver already exists
            const existing = await DriverModel.findOne({ userId: body.userId });
            if (existing) throw new Error('Driver profile already exists');

            const driver = await DriverModel.create({
                driverId: `DRV-${randomUUID()}`,
                userId: body.userId,
                operatorId: body.operatorId,
                licenseNumber: body.licenseNumber,
                licenseExpiry: body.licenseExpiry
            });

            return reply.status(201).send({ success: true, data: driver });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /drivers?operatorId=X&page=1&limit=20 - List drivers
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        const { operatorId, status } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = {};
        if (operatorId) filter.operatorId = operatorId;
        if (status) filter.status = status;

        const [drivers, total] = await Promise.all([
            DriverModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(params.skip)
                .limit(params.limit),
            DriverModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(drivers, total, params));
    }

    /**
     * GET /drivers/:id - Get driver details
     */
    static async getById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        const driver = await DriverModel.findOne({ driverId: id });
        if (!driver) return reply.status(404).send({ error: 'Driver not found' });

        // Populate user details
        const user = await UserModel.findOne({ userId: driver.userId });

        return reply.send({
            success: true,
            data: {
                ...driver.toJSON(),
                user: user ? { firstName: user.firstName, lastName: user.lastName, phone: user.phone } : null
            }
        });
    }

    /**
     * PATCH /drivers/:id - Update driver
     */
    static async update(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const updates = UpdateDriverSchema.parse(req.body);

        const driver = await DriverModel.findOneAndUpdate(
            { driverId: id },
            { $set: updates },
            { new: true }
        );

        if (!driver) return reply.status(404).send({ error: 'Driver not found' });

        return reply.send({ success: true, data: driver });
    }

    /**
     * POST /drivers/:id/assign-vehicle - Assign vehicle to driver
     */
    static async assignVehicle(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { vehicleId } = z.object({ vehicleId: z.string() }).parse(req.body);

        try {
            const driver = await DriverModel.findOne({ driverId: id });
            if (!driver) throw new Error('Driver not found');

            const vehicle = await VehicleModel.findOne({ vehicleId });
            if (!vehicle) throw new Error('Vehicle not found');

            // Unassign previous driver if any
            if (vehicle.activeDriverId) {
                await DriverModel.updateOne(
                    { driverId: vehicle.activeDriverId },
                    { $unset: { assignedVehicleId: 1 } }
                );
            }

            // Assign new driver
            driver.assignedVehicleId = vehicleId;
            await driver.save();

            vehicle.activeDriverId = id;
            await vehicle.save();

            return reply.send({ success: true, message: 'Vehicle assigned successfully' });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /drivers/:id/deactivate - Deactivate driver
     */
    static async deactivate(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        const driver = await DriverModel.findOneAndUpdate(
            { driverId: id },
            { isActive: false, status: DriverStatus.INACTIVE },
            { new: true }
        );

        if (!driver) return reply.status(404).send({ error: 'Driver not found' });

        return reply.send({ success: true, message: 'Driver deactivated' });
    }
}
