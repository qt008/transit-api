import { FastifyInstance } from 'fastify';
import { FleetController } from './controllers/fleet.controller';
import { VehicleController } from './controllers/vehicle.controller';
import { RouteController } from './controllers/route.controller';
import { ScheduleController } from './controllers/schedule.controller';
import { TripController } from './controllers/trip.controller';
import { RatingController } from './controllers/rating.controller';

export async function fleetRoutes(fastify: FastifyInstance) {

    // Vehicle Management (Dashboard only)
    fastify.post('/vehicles', VehicleController.create);
    fastify.get('/vehicles', VehicleController.list);
    fastify.get('/vehicles/:id', VehicleController.getById);
    fastify.patch('/vehicles/:id', VehicleController.update);
    fastify.post('/vehicles/:id/assign-routes', VehicleController.assignRoutes);
    fastify.post('/vehicles/:id/transition-route', VehicleController.transitionRoute);

    // Route Management (Dashboard)
    fastify.post('/routes', RouteController.create);
    fastify.get('/routes', RouteController.list);
    fastify.get('/routes/:id', RouteController.getById);
    fastify.patch('/routes/:id', RouteController.update);
    fastify.post('/routes/:id/stops', RouteController.addStop);
    fastify.delete('/routes/:id/stops/:stopId', RouteController.removeStop);
    fastify.post('/routes/:id/access-control', RouteController.setAccessControl);

    // Schedule Management (Dashboard)
    fastify.post('/schedules', ScheduleController.create);
    fastify.get('/schedules', ScheduleController.list);
    fastify.patch('/schedules/:id', ScheduleController.update);
    fastify.delete('/schedules/:id', ScheduleController.cancel);

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
}
