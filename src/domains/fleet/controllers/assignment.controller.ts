import { FastifyRequest, FastifyReply } from 'fastify';
import { VehicleAssignmentModel, AssignmentStatus } from '../models/vehicle-assignment.model';
import { VehicleModel, VehicleStatus } from '../models/vehicle.model';
import { DriverModel, DriverStatus } from '../models/driver.model';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const assignSchema = z.object({
    vehicleId: z.string(),
    driverId: z.string(),
    notes: z.string().optional()
});

const returnSchema = z.object({
    endMileage: z.number().min(0),
    notes: z.string().optional()
});

export class AssignmentController {

    static async assign(req: FastifyRequest, reply: FastifyReply) {
        try {
            const tenantId = req.user?.tenantId;
            const { vehicleId, driverId, notes } = assignSchema.parse(req.body);

            // 1. Fetch Vehicle and Driver
            const vehicle = await VehicleModel.findOne({ vehicleId, tenantId });
            const driver = await DriverModel.findOne({ driverId, tenantId });

            if (!vehicle || !driver) {
                throw new Error('Vehicle or Driver not found');
            }

            if (vehicle.status !== VehicleStatus.ACTIVE) {
                throw new Error(`Vehicle is not available (Status: ${vehicle.status})`);
            }

            if (driver.status !== DriverStatus.ACTIVE) {
                throw new Error(`Driver is not active (Status: ${driver.status})`);
            }

            // 2. Check for existing active assignments
            const existingVehicleAssignment = await VehicleAssignmentModel.findOne({
                vehicleId,
                status: AssignmentStatus.ACTIVE
            });

            if (existingVehicleAssignment) {
                throw new Error(`Vehicle is already assigned to ${existingVehicleAssignment.driverName}`);
            }

            const existingDriverAssignment = await VehicleAssignmentModel.findOne({
                driverId,
                status: AssignmentStatus.ACTIVE
            });

            if (existingDriverAssignment) {
                throw new Error(`Driver is already assigned to vehicle ${existingDriverAssignment.vehicleReg}`);
            }

            // 3. Create Assignment
            const assignmentId = `ASN-${randomUUID()}`;
            const assignment = await VehicleAssignmentModel.create({
                assignmentId,
                tenantId,
                vehicleId,
                vehicleReg: vehicle.registrationNumber,
                driverId,
                driverName: `${driver.firstName} ${driver.lastName}`,
                status: AssignmentStatus.ACTIVE,
                assignedAt: new Date(),
                assignedBy: req.user?.id,
                startMileage: vehicle.currentMileage,
                notes
            });

            // 4. Update Vehicle and Driver Pointers for quick access
            vehicle.assignedDriverId = driverId;
            vehicle.assignedDriverName = `${driver.firstName} ${driver.lastName}`;
            vehicle.activeDriverId = driverId; // Backward compat
            await vehicle.save();

            driver.currentVehicleId = vehicleId;
            driver.currentVehicleReg = vehicle.registrationNumber;
            await driver.save();

            return reply.send(assignment);

        } catch (error: any) {
            return reply.status(400).send({ error: error.message || 'Assignment failed' });
        }
    }

    static async returnVehicle(req: FastifyRequest, reply: FastifyReply) {
        try {
            const { id } = req.params as { id: string }; // Assignment ID
            const tenantId = req.user?.tenantId;
            const { endMileage, notes } = returnSchema.parse(req.body);

            // Find assignment
            const assignment = await VehicleAssignmentModel.findOne({
                assignmentId: id,
                tenantId
            });

            if (!assignment) {
                throw new Error('Assignment not found');
            }

            if (assignment.status !== AssignmentStatus.ACTIVE) {
                throw new Error('Assignment is already completed or revoked');
            }

            if (endMileage < assignment.startMileage) {
                throw new Error('End mileage cannot be less than start mileage');
            }

            // Update Assignment
            assignment.status = AssignmentStatus.COMPLETED;
            assignment.returnedAt = new Date();
            assignment.returnedBy = req.user?.id;
            assignment.endMileage = endMileage;
            if (notes) assignment.notes = (assignment.notes ? assignment.notes + '\n' : '') + `Return Note: ${notes}`;

            await assignment.save();

            // Unlink Vehicle
            const vehicle = await VehicleModel.findOne({ vehicleId: assignment.vehicleId });
            if (vehicle) {
                vehicle.assignedDriverId = undefined;
                vehicle.assignedDriverName = undefined;
                vehicle.activeDriverId = undefined;
                vehicle.currentMileage = endMileage; // Update mileage
                await vehicle.save();
            }

            // Unlink Driver
            const driver = await DriverModel.findOne({ driverId: assignment.driverId });
            if (driver) {
                driver.currentVehicleId = undefined;
                driver.currentVehicleReg = undefined;
                await driver.save();
            }

            return reply.send(assignment);

        } catch (error: any) {
            return reply.status(400).send({ error: error.message || 'Return failed' });
        }
    }

    static async getHistory(req: FastifyRequest, reply: FastifyReply) {
        try {
            const tenantId = req.user?.tenantId;
            const { vehicleId, driverId } = req.query as { vehicleId?: string; driverId?: string };

            const query: any = { tenantId };
            if (vehicleId) query.vehicleId = vehicleId;
            if (driverId) query.driverId = driverId;

            const history = await VehicleAssignmentModel.find(query)
                .sort({ assignedAt: -1 })
                .limit(50);

            return reply.send({ data: history });
        } catch (error) {
            return reply.status(500).send({ error: 'Failed to fetch history' });
        }
    }
}
