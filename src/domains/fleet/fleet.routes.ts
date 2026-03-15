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
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from '../identity/models/user.model';

const SA_ONLY = [Role.SUPER_ADMIN];
const ADMINS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];
const ADMIN_READERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.INSPECTOR, Role.GOVERNMENT];
const SCHEDULE_READERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.DRIVER];
const TRIP_READERS = [Role.SUPER_ADMIN, Role.OPERATOR_ADMIN, Role.INSPECTOR, Role.GOVERNMENT, Role.DRIVER];

export async function fleetRoutes(fastify: FastifyInstance) {

    // ── File upload (documents) ───────────────────────────────────────────────
    fastify.post('/upload', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, UploadController.upload);

    // ── Vehicle Management ────────────────────────────────────────────────────
    fastify.post('/vehicles', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, VehicleController.create);

    fastify.get('/vehicles', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMIN_READERS)]
    }, VehicleController.list);

    fastify.get('/vehicles/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMIN_READERS)]
    }, VehicleController.getById);

    fastify.patch('/vehicles/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, VehicleController.update);

    fastify.post('/vehicles/:id/maintenance', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, VehicleController.setMaintenance);

    fastify.post('/vehicles/:id/documents', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, VehicleController.addDocument);

    fastify.patch('/vehicles/:id/seats', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, VehicleController.updateSeat);

    fastify.post('/vehicles/:id/assign-routes', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, VehicleController.assignRoutes);

    fastify.post('/vehicles/:id/transition-route', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, VehicleController.transitionRoute);

    // ── Vehicle Assignment ────────────────────────────────────────────────────
    fastify.post('/vehicles/assign', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, AssignmentController.assign);

    fastify.post('/vehicles/return/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, AssignmentController.returnVehicle);

    fastify.get('/vehicles/assignment-history', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, AssignmentController.getHistory);

    // ── Maintenance Management ────────────────────────────────────────────────
    fastify.post('/maintenance', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, MaintenanceController.create);

    fastify.get('/maintenance', {
        preHandler: [fastify.authenticate, requireAnyRole([...ADMINS, Role.INSPECTOR])]
    }, MaintenanceController.list);

    fastify.get('/maintenance/stats', {
        preHandler: [fastify.authenticate, requireAnyRole([...ADMINS, Role.INSPECTOR])]
    }, MaintenanceController.getStats);

    fastify.patch('/maintenance/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, MaintenanceController.update);

    // ── Driver Management (fleet domain) ──────────────────────────────────────
    fastify.post('/drivers', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, DriverController.create);

    fastify.get('/drivers', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMIN_READERS)]
    }, DriverController.list);

    fastify.get('/drivers/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMIN_READERS)]
    }, DriverController.getById);

    fastify.patch('/drivers/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, DriverController.update);

    fastify.post('/drivers/:id/documents', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, DriverController.addDocument);

    // ── Fuel Tracking ──────────────────────────────────────────────────────────
    fastify.post('/fuel-logs', {
        preHandler: [fastify.authenticate, requireAnyRole([...ADMINS, Role.DRIVER])]
    }, FuelLogController.create);

    fastify.get('/fuel-logs', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, FuelLogController.list);

    fastify.get('/fuel-logs/stats', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, FuelLogController.getStats);

    // ── Route Management ──────────────────────────────────────────────────────
    fastify.post('/routes', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.create);

    // Routes are broadly readable (drivers + passengers may look up routes)
    fastify.get('/routes', { preHandler: [fastify.authenticate] }, RouteController.list);
    fastify.get('/routes/:id', { preHandler: [fastify.authenticate] }, RouteController.getById);

    fastify.patch('/routes/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.update);

    fastify.post('/routes/:id/stops', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.addStop);

    fastify.delete('/routes/:id/stops/:stopId', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.removeStop);

    // Route access control (who can book which route) — SUPER_ADMIN platform operation
    fastify.post('/routes/:id/access-control', {
        preHandler: [fastify.authenticate, requireAnyRole(SA_ONLY)]
    }, RouteController.setAccessControl);

    // ── Schedule Management ────────────────────────────────────────────────────
    fastify.post('/schedules', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, ScheduleController.create);

    fastify.get('/schedules', {
        preHandler: [fastify.authenticate, requireAnyRole(SCHEDULE_READERS)]
    }, ScheduleController.list);

    fastify.patch('/schedules/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, ScheduleController.update);

    fastify.delete('/schedules/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, ScheduleController.cancel);

    // ── Route Pricing ─────────────────────────────────────────────────────────
    fastify.post('/routes/:id/pricing', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.setPricing);

    fastify.get('/routes/:id/pricing', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.getPricing);

    // Fare calculation is accessible to all authenticated users (e.g. passengers estimating cost)
    fastify.post('/routes/:id/pricing/calculate', {
        preHandler: [fastify.authenticate]
    }, RouteController.calculateFare);

    fastify.get('/routes/:id/pricing/matrix', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.generateFareMatrix);

    fastify.post('/routes/:id/pricing/validate', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, RouteController.validateFareMatrix);

    // ── Trip Management — Admin ────────────────────────────────────────────────
    fastify.post('/trips/generate', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, TripController.generateTrips);

    fastify.get('/trips', {
        preHandler: [fastify.authenticate, requireAnyRole(TRIP_READERS)]
    }, TripController.list);

    fastify.get('/trips/:id', {
        preHandler: [fastify.authenticate, requireAnyRole(TRIP_READERS)]
    }, TripController.getById);

    fastify.get('/trips/:id/availability', {
        preHandler: [fastify.authenticate]
    }, TripController.getAvailability);

    // Seat lookup: public — used for pre-booking queries on the web/mobile before login
    fastify.get('/trips/:id/seats', TripController.getSeatsForSegment);

    fastify.patch('/trips/:id/status', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, TripController.updateStatus);

    // ── Trip Operations — Driver ───────────────────────────────────────────────
    fastify.post('/trips/start', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.DRIVER])]
    }, TripController.start);

    fastify.post('/trips/:id/update-stop', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.DRIVER])]
    }, TripController.updateStop);

    fastify.post('/trips/:id/complete', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.DRIVER])]
    }, TripController.complete);

    fastify.get('/trips/active', {
        preHandler: [fastify.authenticate, requireAnyRole(TRIP_READERS)]
    }, TripController.getActive);

    // ── Rating System — Passenger ──────────────────────────────────────────────
    fastify.post('/trips/:id/rate', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.PASSENGER])]
    }, RatingController.rateTrip);

    // Reviews and rating summaries are public — visible without login
    fastify.get('/drivers/:id/reviews', RatingController.getDriverReviews);
    fastify.get('/drivers/:id/rating-summary', RatingController.getRatingSummary);

    // ── Telemetry ─────────────────────────────────────────────────────────────
    // Must be authenticated — prevents spoofed GPS position injection
    fastify.post('/telemetry', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.DRIVER])]
    }, FleetController.updateLocation);

    // Nearby vehicle search — public, used in passenger map view
    fastify.get('/nearby', FleetController.findNearby);

    // ── Fleet Configuration ────────────────────────────────────────────────────
    fastify.get('/config', {
        preHandler: [fastify.authenticate, requireAnyRole(ADMINS)]
    }, FleetConfigController.getConfig);

    // Config mutations are SUPER_ADMIN only (platform-wide impact)
    fastify.patch('/config', {
        preHandler: [fastify.authenticate, requireAnyRole(SA_ONLY)]
    }, FleetConfigController.updateConfig);

    // ── Branch Management (nested) ─────────────────────────────────────────────
    fastify.register(branchRoutes, { prefix: '/branches' });
}
