import { FastifyRequest, FastifyReply } from 'fastify';
import { VehicleModel, VehicleStatus, VehicleType, SeatType } from '../models/vehicle.model';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';
import { SeatConfigService } from '../services/seat-config.service';

const SeatNodeSchema = z.object({
    id: z.string(),
    row: z.number(),
    col: z.number(),
    type: z.enum(['SEAT', 'AISLE', 'DRIVER', 'EMPTY', 'DOOR']),
    label: z.string(),
    seatType: z.string(),
    isAvailable: z.boolean(),
    price: z.number().optional()
});

const SeatLayoutSchema = z.object({
    totalRows: z.number(),
    totalColumns: z.number(),
    seats: z.array(SeatNodeSchema)
});

const CreateVehicleSchema = z.object({
    operatorId: z.string().optional(), // Optional/Deprecated alias
    tenantId: z.string().optional(), // Should come from auth
    registrationNumber: z.string(),
    plateNumber: z.string().optional(), // Alias
    make: z.string(),
    vehicleModel: z.string(),
    year: z.number(),
    color: z.string(),
    vin: z.string().optional(),
    type: z.nativeEnum(VehicleType),
    totalSeats: z.number(),
    fuelType: z.enum(['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID']),
    fuelCapacity: z.number(),
    seatLayout: SeatLayoutSchema.optional()
});

const UpdateVehicleSchema = z.object({
    make: z.string().optional(),
    vehicleModel: z.string().optional(),
    color: z.string().optional(),
    status: z.nativeEnum(VehicleStatus).optional(),
    currentMileage: z.number().optional(),
    seatLayout: SeatLayoutSchema.optional()
});

const MaintenanceSchema = z.object({
    isMaintenanceMode: z.boolean(),
    reason: z.string().optional(),
    estimatedReturnDate: z.string().transform(s => new Date(s)).optional()
});

const AddDocumentSchema = z.object({
    documentType: z.enum(['INSURANCE', 'ROADWORTHY', 'REGISTRATION', 'PERMIT', 'OTHER']),
    documentNumber: z.string(),
    issueDate: z.string().transform(str => new Date(str)),
    expiryDate: z.string().transform(str => new Date(str)),
    fileUrl: z.string().optional(),
    fileName: z.string().optional(),
    notes: z.string().optional()
});

export class VehicleController {

    private static seatService = new SeatConfigService();

    /**
     * POST /vehicles - Create vehicle
     */
    static async create(req: FastifyRequest, reply: FastifyReply) {
        const body = CreateVehicleSchema.parse(req.body);
        // @ts-ignore
        const tenantId = req.user?.tenantId || body.operatorId || 'default';

        try {
            const regNum = body.registrationNumber || body.plateNumber;
            if (!regNum) throw new Error('Registration number is required');

            const existing = await VehicleModel.findOne({ registrationNumber: regNum });
            if (existing) throw new Error('Vehicle with this registration number already exists');

            // Generate seats
            const seatConfiguration = VehicleController.seatService.generateSeatLayout(
                body.type,
                body.totalSeats
            );

            const vehicle = await VehicleModel.create({
                vehicleId: `VEH-${randomUUID()}`,
                tenantId,
                operatorId: tenantId, // Compat
                plateNumber: regNum, // Compat
                ...body,
                seatConfiguration,
                assignedRoutes: [],
                currentRouteIndex: 0,
                documents: [],
                maintenanceHistory: [],
                status: VehicleStatus.ACTIVE
            });

            return reply.status(201).send({ success: true, data: vehicle });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /vehicles - List vehicles
     */
    static async list(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const { tenantId, branchIds, roles } = req.user || {};
        const { operatorId, status, search, branchId } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = {};
        if (tenantId) filter.tenantId = tenantId;
        else if (operatorId) filter.tenantId = operatorId; // Fallback/Admin

        // Branch Scoping
        if (roles && !roles.includes('SUPER_ADMIN')) {
            if (branchId) {
                if (branchIds?.includes(branchId)) {
                    filter.baseBranchId = branchId;
                } else {
                    return reply.send(createPaginatedResponse([], 0, params));
                }
            } else if (branchIds && branchIds.length > 0) {
                filter.baseBranchId = { $in: branchIds };
            }
        } else {
            if (branchId) filter.baseBranchId = branchId;
        }

        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { registrationNumber: { $regex: search, $options: 'i' } },
                { make: { $regex: search, $options: 'i' } },
                { vehicleModel: { $regex: search, $options: 'i' } }
            ];
        }

        const [vehicles, total] = await Promise.all([
            VehicleModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(params.skip)
                .limit(params.limit),
            VehicleModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(vehicles, total, params));
    }

    /**
     * GET /vehicles/:id - Get vehicle
     */
    static async getById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };

        const vehicle = await VehicleModel.findOne({ vehicleId: id });
        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });

        return reply.send({ success: true, data: vehicle });
    }

    /**
     * PATCH /vehicles/:id - Update vehicle
     */
    static async update(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const updates = UpdateVehicleSchema.parse(req.body);

        const vehicle = await VehicleModel.findOneAndUpdate(
            { vehicleId: id },
            { $set: updates },
            { new: true }
        );

        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });

        return reply.send({ success: true, data: vehicle });
    }

    /**
     * POST /vehicles/:id/maintenance - Toggle maintenance mode
     */
    static async setMaintenance(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { isMaintenanceMode, reason, estimatedReturnDate } = MaintenanceSchema.parse(req.body);

        const updates: any = {
            isMaintenanceMode,
            status: isMaintenanceMode ? VehicleStatus.MAINTENANCE : VehicleStatus.ACTIVE
        };

        if (isMaintenanceMode) {
            updates.maintenanceReason = reason;
            updates.maintenanceStartDate = new Date();
            updates.estimatedReturnDate = estimatedReturnDate;
        }

        const vehicle = await VehicleModel.findOneAndUpdate(
            { vehicleId: id },
            { $set: updates },
            { new: true }
        );

        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });
        return reply.send({ success: true, data: vehicle });
    }

    /**
     * POST /vehicles/:id/documents - Add document (Insurance, Roadworthy)
     */
    static async addDocument(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const doc = AddDocumentSchema.parse(req.body);

        const status = new Date(doc.expiryDate) < new Date() ? 'EXPIRED' : 'VALID';

        const vehicle = await VehicleModel.findOneAndUpdate(
            { vehicleId: id },
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

        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });
        return reply.send({ success: true, data: vehicle });
    }

    /**
     * POST /vehicles/:id/seats - Update seat config (e.g. mark broken/unavailable)
     */
    static async updateSeat(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { seatNumber, isAvailable, type } = z.object({
            seatNumber: z.string(),
            isAvailable: z.boolean().optional(),
            type: z.string().optional()
        }).parse(req.body);

        const vehicle = await VehicleModel.findOne({ vehicleId: id });
        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });

        const seat = vehicle.seatConfiguration.find(s => s.seatNumber === seatNumber);
        if (!seat) return reply.status(404).send({ error: 'Seat not found' });

        if (isAvailable !== undefined) seat.isAvailable = isAvailable;
        if (type) seat.type = type as any;

        await vehicle.save();
        return reply.send({ success: true, data: vehicle });
    }

    // Assign Routes (Legacy/Existing)
    static async assignRoutes(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { routeIds } = z.object({ routeIds: z.array(z.string()) }).parse(req.body);

        const vehicle = await VehicleModel.findOneAndUpdate(
            { vehicleId: id },
            { assignedRoutes: routeIds, currentRouteIndex: 0 },
            { new: true }
        );

        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });
        return reply.send({ success: true, data: vehicle });
    }

    static async transitionRoute(req: FastifyRequest, reply: FastifyReply) {
        // Implementation kept from previous version if needed, or simplified
        // ... (Similar to original)
        const { id } = req.params as { id: string };
        const vehicle = await VehicleModel.findOne({ vehicleId: id });
        if (!vehicle) return reply.status(404).send({ error: 'Vehicle not found' });

        if (vehicle.assignedRoutes.length === 0) throw new Error('No routes assigned');

        const nextIndex = (vehicle.currentRouteIndex + 1) % vehicle.assignedRoutes.length;
        vehicle.currentRouteIndex = nextIndex;
        await vehicle.save();

        return reply.send({ success: true, data: vehicle });
    }
}
