import { VehicleModel } from '../models/vehicle.model';
import { DriverModel } from '../models/driver.model';
import { SMSService } from '../../../services/sms.service';

export class DocumentMonitorService {
    private smsService = new SMSService();

    /**
     * Update document statuses based on expiry dates
     */
    async updateDocumentStatuses(): Promise<void> {
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Update vehicle documents
        await VehicleModel.updateMany(
            { 'documents.expiryDate': { $lt: now } },
            { $set: { 'documents.$[elem].status': 'EXPIRED' } },
            { arrayFilters: [{ 'elem.expiryDate': { $lt: now } }] }
        );

        await VehicleModel.updateMany(
            {
                'documents.expiryDate': { $gte: now, $lte: thirtyDaysFromNow },
                'documents.status': { $ne: 'EXPIRED' }
            },
            { $set: { 'documents.$[elem].status': 'EXPIRING_SOON' } },
            {
                arrayFilters: [{
                    'elem.expiryDate': { $gte: now, $lte: thirtyDaysFromNow },
                    'elem.status': { $ne: 'EXPIRED' }
                }]
            }
        );

        // Update driver documents (same logic)
        await DriverModel.updateMany(
            { 'documents.expiryDate': { $lt: now } },
            { $set: { 'documents.$[elem].status': 'EXPIRED' } },
            { arrayFilters: [{ 'elem.expiryDate': { $lt: now } }] }
        );

        await DriverModel.updateMany(
            {
                'documents.expiryDate': { $gte: now, $lte: thirtyDaysFromNow },
                'documents.status': { $ne: 'EXPIRED' }
            },
            { $set: { 'documents.$[elem].status': 'EXPIRING_SOON' } },
            {
                arrayFilters: [{
                    'elem.expiryDate': { $gte: now, $lte: thirtyDaysFromNow },
                    'elem.status': { $ne: 'EXPIRED' }
                }]
            }
        );
    }

    /**
     * Get expiring documents report
     */
    async getExpiringDocuments(tenantId: string) {
        const vehicles = await VehicleModel.find({
            tenantId,
            'documents.status': { $in: ['EXPIRING_SOON', 'EXPIRED'] }
        });

        const drivers = await DriverModel.find({
            tenantId,
            $or: [
                { 'documents.status': { $in: ['EXPIRING_SOON', 'EXPIRED'] } },
                { licenseExpiryDate: { $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }
            ]
        });

        return { vehicles, drivers };
    }
}
