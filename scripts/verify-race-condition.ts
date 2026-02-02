
import mongoose from 'mongoose';
import { TripModel, TripStatus } from '../src/domains/fleet/models/trip.model';
import { BookingService } from '../src/domains/ticketing/services/booking.service';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../src/config/env';

/**
 * Verification Script for Booking Race Condition
 * 
 * Usage: npx ts-node scripts/verify-race-condition.ts
 */

async function run() {
    console.log('--- Starting Race Condition Verification ---');

    // 1. Connect to DB
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected to MongoDB');

    try {
        // 2. Setup Test Trip
        const tripId = `TEST-TRIP-${uuidv4()}`;
        const seatNumber = "1A";

        await TripModel.create({
            tripId,
            scheduleId: 'TEST-SCH',
            routeId: 'TEST-ROUTE',
            vehicleId: 'TEST-VEHICLE',
            driverId: 'TEST-DRIVER',
            branchId: 'TEST-BRANCH',
            operatorId: 'TEST-OP',
            tenantId: 'TEST-TENANT',
            scheduledDepartureDate: new Date(),
            scheduledDepartureTime: '10:00',
            status: TripStatus.SCHEDULED,
            currentStopIndex: 0,
            totalSeats: 40,
            availableSeats: 40,
            bookedSeats: [],
            stops: [],
            passengers: 0,
            revenue: 0,
            createdBy: 'TEST'
        });
        console.log(`Created test trip: ${tripId} with seat ${seatNumber} available`);

        // 3. Simulate Concurrent Requests
        const CONCURRENCY = 10;
        const promises = [];

        console.log(`Simulating ${CONCURRENCY} concurrent booking attempts for seat ${seatNumber}...`);

        for (let i = 0; i < CONCURRENCY; i++) {
            promises.push(
                BookingService.createBooking({
                    userId: `USER-${i}`,
                    tripId,
                    routeId: 'TEST-ROUTE',
                    fromStopId: 'STOP-A',
                    toStopId: 'STOP-B',
                    seatNumber,
                    passengerName: `Passenger ${i}`,
                    passengerPhone: '0000000000',
                    channel: 'WEB' as any,
                    bookedBy: `USER-${i}`,
                    tenantId: 'TEST-TENANT'
                }).then(() => ({ status: 'fulfilled', id: i }))
                    .catch((err) => ({ status: 'rejected', id: i, reason: err.message }))
            );
        }

        const results = await Promise.all(promises);

        // 4. Analyze Results
        const successes = results.filter(r => r.status === 'fulfilled');
        const failures = results.filter(r => r.status === 'rejected');

        console.log(`Results: ${successes.length} success, ${failures.length} failed`);

        if (successes.length === 1 && failures.length === CONCURRENCY - 1) {
            console.log('✅ PASS: Only one booking succeeded. Race condition prevented.');
        } else {
            console.error('❌ FAIL: Unexpected number of successes/failures.');
            if (successes.length > 1) console.error('CRITICAL: Multiple bookings created for same seat!');

            console.log('Failure Reasons (Sample):');
            failures.slice(0, 3).forEach((f: any) => console.log(`- Request ${f.id}: ${f.reason}`));
        }

        // Cleanup
        await TripModel.deleteOne({ tripId });
        // Clean up created booking (if any)
        // Note: In a real test env we would clean up BookingModel too

    } catch (err) {
        console.error('Test execution failed:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
}

run();
