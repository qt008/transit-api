import { FastifyRequest, FastifyReply } from 'fastify';
import { DriverModel, DriverStatus } from '../models/driver.model';
import { VehicleModel } from '../models/vehicle.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';
import { DocumentMonitorService } from '../services/document-monitor.service';

const CreateDriverSchema = z.object({
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string(),
    email: z.string().email().optional(),
    dateOfBirth: z.string().transform(str => new Date(str)),
    licenseNumber: z.string(),
    licenseClass: z.string(),
    licenseIssueDate: z.string().transform(str => new Date(str)),
    licenseExpiryDate: z.string().transform(str => new Date(str)),
    emergencyContactName: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
    address: z.string().optional()
});

const UpdateDriverSchema = z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    status: z.nativeEnum(DriverStatus).optional(),
    currentVehicleId: z.string().optional()
});

const AddDocumentSchema = z.object({
    documentType: z.enum(['LICENSE', 'MEDICAL_CERT', 'BACKGROUND_CHECK', 'CONTRACT', 'OTHER']),
    documentNumber: z.string(),
    issueDate: z.string().transform(str => new Date(str)),
    expiryDate: z.string().transform(str => new Date(str)),
    fileUrl: z.string().optional(),
    fileName: z.string().optional(),
    notes: z.string().optional()
});

export class DriverController {

    /**
     * POST /drivers - Create driver
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default'; // Assuming tenantId from auth
        // @ts-ignore
        const userId = req.user?.userId; // Link to creating user if needed, or if creating a driver account

        const body = CreateDriverSchema.parse(req.body);

        try {
            const existing = await DriverModel.findOne({
                $or: [{ licenseNumber: body.licenseNumber }, { phone: body.phone }]
            });
            if (existing) throw new Error('Driver with this license or phone already exists');

            const driver = await DriverModel.create({
                driverId: `DRV-${randomUUID()}`,
                userId: userId || `USER-${randomUUID()}`, // Placeholder if not linking to real user yet
                tenantId,
                ...body,
                status: DriverStatus.ACTIVE,
                documents: [],
                totalTrips: 0,
                rating: 0
            });

            return reply.status(201).send({ success: true, data: driver });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /drivers - List drivers
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const { tenantId, branchIds, roles } = req.user || {};
        const { status, search, branchId } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = {};
        if (tenantId) filter.tenantId = tenantId;

        // Branch Scoping
        if (roles && !roles.includes('SUPER_ADMIN')) {
            if (branchId) {
                // strict check
                if (branchIds?.includes(branchId)) {
                    filter.baseBranchId = branchId;
                } else {
                    return reply.send(createPaginatedResponse([], 0, params));
                }
            } else if (branchIds && branchIds.length > 0) {
                filter.baseBranchId = { $in: branchIds };
            }
        } else {
            // Admin can filter by branch
            if (branchId) filter.baseBranchId = branchId;
        }

        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { licenseNumber: { $regex: search, $options: 'i' } }
            ];
        }

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
        return reply.send({ success: true, data: driver });
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
     * POST /drivers/:id/documents - Add document
     */
    static async addDocument(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const doc = AddDocumentSchema.parse(req.body);

        const status = new Date(doc.expiryDate) < new Date() ? 'EXPIRED' : 'VALID';

        const driver = await DriverModel.findOneAndUpdate(
            { driverId: id },
            {
                $push: {
                    documents: {
                        ...doc,
                        uploadedAt: new Date(),
                        status
                    }
                }
            },
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

            // Find vehicle (and ensure it exists in same tenant if applicable, though vehicleId is likely unique enough)
            // Ideally we check tenantId match too
            const vehicle = await VehicleModel.findOne({ vehicleId });
            if (!vehicle) throw new Error('Vehicle not found');

            // 1. If vehicle is already assigned to another driver, unassign that driver
            if (vehicle.activeDriverId && vehicle.activeDriverId !== id) {
                await DriverModel.updateOne(
                    { driverId: vehicle.activeDriverId },
                    { $unset: { currentVehicleId: 1, currentVehicleReg: 1 } }
                );
            }

            // 2. If driver is already assigned to another vehicle, unassign that vehicle
            if (driver.currentVehicleId && driver.currentVehicleId !== vehicleId) {
                await VehicleModel.updateOne(
                    { vehicleId: driver.currentVehicleId },
                    { $unset: { activeDriverId: 1 } }
                );
            }

            // 3. Link new pair
            driver.currentVehicleId = vehicleId;
            driver.currentVehicleReg = vehicle.plateNumber || vehicle.registrationNumber;
            await driver.save();

            vehicle.activeDriverId = id;
            await vehicle.save();

            return reply.send({ success: true, message: 'Vehicle assigned successfully', data: driver });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }
}
