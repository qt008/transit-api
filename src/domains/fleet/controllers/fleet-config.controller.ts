import { FastifyRequest, FastifyReply } from 'fastify';
import { FleetConfigModel, IFleetConfig } from '../models/fleet-config.model';

export class FleetConfigController {
    // Get config (create default if not exists)
    static async getConfig(req: FastifyRequest, reply: FastifyReply) {
        try {
            const tenantId = 'TENANT-DEFAULT'; // TODO: Get from auth
            let config = await FleetConfigModel.findOne({ tenantId });

            if (!config) {
                // Initialize default config
                config = await FleetConfigModel.create({
                    tenantId,
                    makes: [
                        { name: 'Toyota', models: ['HiAce', 'Corolla', 'Coaster'] },
                        { name: 'Nissan', models: ['Urvan', 'Civilian'] },
                        { name: 'Mercedes', models: ['Sprinter', 'Vito'] }
                    ],
                    vehicleTypes: ['MINI_BUS', 'STANDARD_BUS', 'SPRINTER', 'LUXURY_COACH'],
                    fuelTypes: ['DIESEL', 'PETROL', 'ELECTRIC', 'HYBRID'],
                    colors: ['White', 'Silver', 'Black', 'Dark Blue', 'Red', 'Grey']
                });
            }

            return reply.send({ success: true, config });
        } catch (error) {
            console.error('Get Config Error:', error);
            return reply.status(500).send({ success: false, message: 'Failed to fetch config' });
        }
    }

    // Update config
    static async updateConfig(req: FastifyRequest<{ Body: Partial<IFleetConfig> }>, reply: FastifyReply) {
        try {
            const tenantId = 'TENANT-DEFAULT'; // TODO: Get from auth
            const updates = req.body;

            const config = await FleetConfigModel.findOneAndUpdate(
                { tenantId },
                { $set: updates },
                { new: true, upsert: true }
            );

            return reply.send({ success: true, config });
        } catch (error) {
            console.error('Update Config Error:', error);
            return reply.status(500).send({ success: false, message: 'Failed to update config' });
        }
    }
}
