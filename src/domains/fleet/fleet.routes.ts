import { FastifyInstance } from 'fastify';
import { FleetController } from './controllers/fleet.controller';
import { VehicleController } from './controllers/vehicle.controller';
import { DriverController } from './controllers/driver.controller';
import { FuelLogController } from './controllers/fuel-log.controller';
import { UploadController } from './controllers/upload.controller';
import { RouteController } from './controllers/route.controller';
import { ScheduleController } from './controllers/schedule.controller';
import { TripController } from './controllers/trip.controller';
import { RatingController } from './controllers/rating.controller';
import { FleetConfigController } from './controllers/fleet-config.controller';
import { MaintenanceController } from './controllers/maintenance.controller';
import { AssignmentController } from './controllers/assignment.controller';
import { branchRoutes } from './branch.routes';

export async function fleetRoutes(fastify: FastifyInstance) {

    // Upload Service (for documents)
    fastify.post('/upload', { preHandler: [fastify.authenticate] }, UploadController.upload);

    // Vehicle Management
    fastify.post('/vehicles', { preHandler: [fastify.authenticate] }, VehicleController.create);
    fastify.get('/vehicles', { preHandler: [fastify.authenticate] }, VehicleController.list);
    fastify.get('/vehicles/:id', { preHandler: [fastify.authenticate] }, VehicleController.getById);
    fastify.patch('/vehicles/:id', { preHandler: [fastify.authenticate] }, VehicleController.update);

    // Vehicle Maintenance & Docs
    fastify.post('/vehicles/:id/maintenance', { preHandler: [fastify.authenticate] }, VehicleController.setMaintenance);
    fastify.post('/vehicles/:id/documents', { preHandler: [fastify.authenticate] }, VehicleController.addDocument);
    fastify.patch('/vehicles/:id/seats', { preHandler: [fastify.authenticate] }, VehicleController.updateSeat);

    fastify.post('/vehicles/:id/assign-routes', { preHandler: [fastify.authenticate] }, VehicleController.assignRoutes);
    fastify.post('/vehicles/:id/transition-route', { preHandler: [fastify.authenticate] }, VehicleController.transitionRoute);

    // Vehicle Assignment
    fastify.post('/vehicles/assign', { preHandler: [fastify.authenticate] }, AssignmentController.assign);
    fastify.post('/vehicles/return/:id', { preHandler: [fastify.authenticate] }, AssignmentController.returnVehicle);
    fastify.get('/vehicles/assignment-history', { preHandler: [fastify.authenticate] }, AssignmentController.getHistory);

    // Maintenance Management
    fastify.post('/maintenance', { preHandler: [fastify.authenticate] }, MaintenanceController.create);
    fastify.get('/maintenance', { preHandler: [fastify.authenticate] }, MaintenanceController.list);
    fastify.get('/maintenance/stats', { preHandler: [fastify.authenticate] }, MaintenanceController.getStats);
    fastify.patch('/maintenance/:id', { preHandler: [fastify.authenticate] }, MaintenanceController.update);


    // Driver Management
    fastify.post('/drivers', { preHandler: [fastify.authenticate] }, DriverController.create);
    fastify.get('/drivers', { preHandler: [fastify.authenticate] }, DriverController.list);
    fastify.get('/drivers/:id', { preHandler: [fastify.authenticate] }, DriverController.getById);
    fastify.patch('/drivers/:id', { preHandler: [fastify.authenticate] }, DriverController.update);
    fastify.post('/drivers/:id/documents', { preHandler: [fastify.authenticate] }, DriverController.addDocument);

    // Fuel Tracking
    fastify.post('/fuel-logs', { preHandler: [fastify.authenticate] }, FuelLogController.create);
    fastify.get('/fuel-logs', { preHandler: [fastify.authenticate] }, FuelLogController.list);
    fastify.get('/fuel-logs/stats', { preHandler: [fastify.authenticate] }, FuelLogController.getStats);

    // Route Management (Dashboard)
    fastify.post('/routes', { preHandler: [fastify.authenticate] }, RouteController.create);
    fastify.get('/routes', { preHandler: [fastify.authenticate] }, RouteController.list);
    fastify.get('/routes/:id', { preHandler: [fastify.authenticate] }, RouteController.getById);
    fastify.patch('/routes/:id', { preHandler: [fastify.authenticate] }, RouteController.update);
    fastify.post('/routes/:id/stops', { preHandler: [fastify.authenticate] }, RouteController.addStop);
    fastify.delete('/routes/:id/stops/:stopId', { preHandler: [fastify.authenticate] }, RouteController.removeStop);
    fastify.post('/routes/:id/access-control', { preHandler: [fastify.authenticate] }, RouteController.setAccessControl);

    // Schedule Management (Dashboard)
    fastify.post('/schedules', { preHandler: [fastify.authenticate] }, ScheduleController.create);
    fastify.get('/schedules', { preHandler: [fastify.authenticate] }, ScheduleController.list);
    fastify.patch('/schedules/:id', { preHandler: [fastify.authenticate] }, ScheduleController.update);
    fastify.delete('/schedules/:id', { preHandler: [fastify.authenticate] }, ScheduleController.cancel);

    // Route Pricing (Dashboard)
    fastify.post('/routes/:id/pricing', { preHandler: [fastify.authenticate] }, RouteController.setPricing);
    fastify.get('/routes/:id/pricing', { preHandler: [fastify.authenticate] }, RouteController.getPricing);
    fastify.post('/routes/:id/pricing/calculate', { preHandler: [fastify.authenticate] }, RouteController.calculateFare);
    fastify.get('/routes/:id/pricing/matrix', { preHandler: [fastify.authenticate] }, RouteController.generateFareMatrix);
    fastify.post('/routes/:id/pricing/validate', { preHandler: [fastify.authenticate] }, RouteController.validateFareMatrix);

    // Trip Management (Dashboard)
    fastify.post('/trips/generate', { preHandler: [fastify.authenticate] }, TripController.generateTrips);
    fastify.get('/trips', { preHandler: [fastify.authenticate] }, TripController.list);
    fastify.get('/trips/:id', { preHandler: [fastify.authenticate] }, TripController.getById);
    fastify.get('/trips/:id/availability', { preHandler: [fastify.authenticate] }, TripController.getAvailability);
    fastify.patch('/trips/:id/status', { preHandler: [fastify.authenticate] }, TripController.updateStatus);


    // Trip Management (Mobile - Driver)
    fastify.post('/trips/start', TripController.start);
    fastify.post('/trips/:id/update-stop', TripController.updateStop);
    fastify.post('/trips/:id/complete', TripController.complete);
    fastify.get('/trips/active', TripController.getActive);

    // Rating System (Mobile - Passenger)
    fastify.post('/trips/:id/rate', RatingController.rateTrip);
    fastify.get('/drivers/:id/reviews', RatingController.getDriverReviews);
    fastify.get('/drivers/:id/rating-summary', RatingController.getRatingSummary);

    // Telemetry (Mobile - Driver, Public nearby search)
    fastify.post('/telemetry', FleetController.updateLocation);
    fastify.get('/nearby', FleetController.findNearby);

    // Fleet Configuration
    fastify.get('/config', { preHandler: [fastify.authenticate] }, FleetConfigController.getConfig);
    fastify.patch('/config', { preHandler: [fastify.authenticate] }, FleetConfigController.updateConfig);

    // Branch Management
    fastify.register(branchRoutes, { prefix: '/branches' });
}
