import mongoose from 'mongoose';
import { randomUUID, randomBytes } from 'crypto';
import { TransitCardModel, TransitCardStatus } from '../models/transit-card.model';
import { JourneyModel, JourneyStatus } from '../models/journey.model';
import { RoutePricingModel } from '../../fleet/models/route-pricing.model';
import { RouteModel } from '../../fleet/models/route.model';
import { TripModel } from '../../fleet/models/trip.model';
import { WalletService } from '../../wallet/services/wallet.service';
import { AccountModel } from '../../wallet/models/account.model';
import { BookingService } from '../../ticketing/services/booking.service';

// Minimum pre-auth: charge the smallest stop-to-stop fare on boarding
// If no matrix entry found, fall back to this % of base price
const PRE_AUTH_FALLBACK_RATIO = 0.3;
// Max orphan window: if tap-off not received within this ms, close as orphaned
const ORPHAN_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

const walletService = new WalletService();

export class TransitService {

    /**
     * Register a physical NFC card to a passenger account.
     * userId and walletAccountId are resolved server-side from the authenticated user —
     * they are never accepted from the request body.
     */
    async registerCard(input: {
        cardUid: string;
        userId: string;           // From req.user.id
        walletAccountId: string;  // From req.user.walletAccountId
        tenantId: string;
        type?: string;
    }) {
        // Normalise UID to uppercase hex for consistent comparison
        const normalisedUid = input.cardUid.trim().toUpperCase();

        // Atomic findOne: check whether UID is already claimed
        const existing = await TransitCardModel.findOne({ cardUid: normalisedUid });
        if (existing) {
            if (existing.userId === input.userId) {
                // Idempotent — passenger re-tapping their own card returns the existing record
                return existing;
            }
            throw new Error('This card is already registered to another account');
        }

        // Generate a collision-safe cardId and random card number
        const cardId = `CARD-${randomUUID()}`;
        const cardNumber = await this.generateUniqueCardNumber();

        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 3); // 3-year validity

        // Use findOneAndUpdate with upsert=false + unique index as the race-condition guard.
        // If two requests arrive for the same UID simultaneously, the unique index on cardUid
        // will reject the second insert at the DB level.
        const card = await TransitCardModel.create({
            cardId,
            cardUid: normalisedUid,
            userId: input.userId,
            walletAccountId: input.walletAccountId,
            tenantId: input.tenantId,
            type: input.type || 'PHYSICAL_NFC',
            status: TransitCardStatus.ACTIVE,
            cardNumber,
            issuedAt: new Date(),
            expiresAt
        });

        return card;
    }

    /**
     * TAP ON — passenger boards at a stop.
     * 1. Validate card is active + wallet has enough for minimum fare
     * 2. Pre-authorize minimum fare (hold in escrow)
     * 3. Open a Journey record
     */
    async tapOn(input: {
        cardUid: string;
        tripId: string;
        stopId: string;
        deviceId: string; // Conductor device ID
        tenantId: string;
    }) {
        const { cardUid, tripId, stopId, deviceId, tenantId } = input;

        // 1. Resolve card
        const card = await TransitCardModel.findOne({ cardUid, tenantId });
        if (!card) throw new Error('Card not registered. Please register at a terminal or via the app.');
        if (card.status !== TransitCardStatus.ACTIVE) throw new Error(`Card is ${card.status.toLowerCase()}`);

        // 2. Check for open journey (prevent double tap-on)
        const openJourney = await JourneyModel.findOne({ cardId: card.cardId, status: JourneyStatus.OPEN });
        if (openJourney) {
            throw new Error('Card already has an active journey. Please tap off first.');
        }

        // 3. Resolve trip + boarding stop
        const trip = await TripModel.findOne({ tripId, tenantId });
        if (!trip) throw new Error('Trip not found');

        // For journeys without specific stop, use last stop to charge full fare
        // This handles: no stopId provided, or stopId not found on this trip's route
        let boardingStop = trip.stops.find(s => s.stopId === stopId);
        
        if (!boardingStop) {
            if (trip.stops.length === 0) {
                // Point-to-point route with no stops defined - use virtual departure
                boardingStop = { 
                    stopId: 'DEPARTURE', 
                    name: 'Departure', 
                    sequence: 0,
                    branchId: '',
                    location: { type: 'Point', coordinates: [0, 0] },
                    estimatedArrivalMinutes: 0
                } as any;
            } else {
                // No valid stopId provided — fall through to last stop for full fare
                const sortedStops = [...trip.stops].sort((a, b) => b.sequence - a.sequence);
                boardingStop = sortedStops[0];
            }
        }

        if (!boardingStop) throw new Error('Unable to resolve boarding stop');

        // 4. Determine pre-auth amount (minimum possible fare for this route)
        const preAuthAmount = await this.resolvePreAuthAmount(trip.routeId, boardingStop.sequence, trip.stops);

        // 5. Check wallet balance
        const wallet = await AccountModel.findOne({ accountId: card.walletAccountId });
        if (!wallet) throw new Error('Wallet not found');
        if (wallet.balance < preAuthAmount) {
            throw new Error(`Insufficient balance. Minimum fare is GHS ${(preAuthAmount / 100).toFixed(2)}`);
        }

        // 6. Pre-auth: debit wallet → operator escrow
        const escrowAccount = await this.resolveOperatorEscrow(trip.operatorId, tenantId);
        const txnId = await walletService.createTransaction({
            debitAccountId: card.walletAccountId,
            creditAccountId: escrowAccount,
            amount: preAuthAmount,
            description: `Transit pre-auth: boarding at ${boardingStop.name}`,
            metadata: { cardId: card.cardId, tripId, stopId, type: 'PRE_AUTH' }
        });

        // 7. Create Journey
        const journey = await JourneyModel.create({
            journeyId: `JRN-${randomUUID()}`,
            cardId: card.cardId,
            cardUid,
            userId: card.userId,
            tripId,
            routeId: trip.routeId,
            vehicleId: trip.vehicleId,
            tenantId,
            boardingStopId: boardingStop.stopId, // Use resolved stop
            boardingStopName: boardingStop.name,
            boardingStopSequence: boardingStop.sequence,
            boardedAt: new Date(),
            boardedByDeviceId: deviceId,
            fare: {
                baseFare: preAuthAmount,
                preAuthAmount,
                finalCharge: 0,
                refundAmount: 0
            },
            walletAccountId: card.walletAccountId,
            transactionId: txnId,
            status: JourneyStatus.OPEN
        });

        // 8. Update card usage
        await TransitCardModel.updateOne(
            { cardId: card.cardId },
            { lastUsedAt: new Date(), lastTripId: tripId }
        );

        return {
            journeyId: journey.journeyId,
            passenger: { userId: card.userId, cardNumber: card.cardNumber },
            boardingStop: boardingStop.name,
            preAuthAmount,
            walletBalance: wallet.balance - preAuthAmount,
            message: `Boarded at ${boardingStop.name}. Pre-auth: GHS ${(preAuthAmount / 100).toFixed(2)}`
        };
    }

    /**
     * TAP OFF — passenger alights at a stop.
     * 1. Find open journey for card
     * 2. Calculate actual fare from fare matrix
     * 3. Charge delta (actual - pre-auth) or refund (pre-auth - actual)
     * 4. Close journey
     */
    async tapOff(input: {
        cardUid: string;
        tripId: string;
        stopId: string;
        deviceId: string;
        tenantId: string;
    }) {
        const { cardUid, tripId, stopId, deviceId, tenantId } = input;

        // 1. Find open journey
        const card = await TransitCardModel.findOne({ cardUid, tenantId });
        if (!card) throw new Error('Card not found');

        const journey = await JourneyModel.findOne({ cardId: card.cardId, status: JourneyStatus.OPEN });
        if (!journey) throw new Error('No active journey found for this card');

        if (journey.tripId !== tripId) {
            throw new Error('Card was boarded on a different trip. Contact staff.');
        }

        // 2. Resolve alighting stop
        const trip = await TripModel.findOne({ tripId, tenantId });
        if (!trip) throw new Error('Trip not found');

        // For tap-off without specific stop, use last stop (destination) for full fare
        let alightingStop = trip.stops.find(s => s.stopId === stopId);
        
        if (!alightingStop) {
            if (trip.stops.length === 0) {
                // Point-to-point route with no stops - use virtual destination
                alightingStop = { 
                    stopId: 'DESTINATION', 
                    name: 'Destination', 
                    sequence: 1,
                    branchId: '',
                    location: { type: 'Point', coordinates: [0, 0] },
                    estimatedArrivalMinutes: 60
                } as any;
            } else {
                // No valid stopId provided — fall through to last stop for full fare
                const sortedStops = [...trip.stops].sort((a, b) => b.sequence - a.sequence);
                alightingStop = sortedStops[0];
            }
        }

        if (!alightingStop) throw new Error('Unable to resolve alighting stop');

        // Only enforce stop ordering when the route has actual stops
        if (trip.stops.length > 0 && alightingStop.sequence <= journey.boardingStopSequence) {
            throw new Error('Alighting stop must be after boarding stop');
        }

        // 3. Calculate actual fare from matrix (falls back to route.basePrice when no matrix)
        const actualFare = await this.resolveFare(
            trip.routeId,
            journey.boardingStopId,
            alightingStop.stopId
        );

        const preAuthAmount = journey.fare.preAuthAmount;
        const delta = actualFare - preAuthAmount;
        const escrowAccount = await this.resolveOperatorEscrow(trip.operatorId, tenantId);

        let finalTxnId = journey.transactionId;
        let refundAmount = 0;

        if (delta > 0) {
            // Actual fare > pre-auth: charge the difference
            const wallet = await AccountModel.findOne({ accountId: card.walletAccountId });
            if (!wallet || wallet.balance < delta) {
                // Insufficient funds for delta — charge what's available, flag for review
                const available = wallet?.balance ?? 0;
                if (available > 0) {
                    finalTxnId = await walletService.createTransaction({
                        debitAccountId: card.walletAccountId,
                        creditAccountId: escrowAccount,
                        amount: available,
                        description: `Transit partial fare top-up: ${journey.boardingStopName} → ${alightingStop.name}`,
                        metadata: { journeyId: journey.journeyId, type: 'FARE_TOPUP', partial: true }
                    });
                }
            } else {
                finalTxnId = await walletService.createTransaction({
                    debitAccountId: card.walletAccountId,
                    creditAccountId: escrowAccount,
                    amount: delta,
                    description: `Transit fare top-up: ${journey.boardingStopName} → ${alightingStop.name}`,
                    metadata: { journeyId: journey.journeyId, type: 'FARE_TOPUP' }
                });
            }
        } else if (delta < 0) {
            // Pre-auth > actual: refund excess back to passenger wallet
            refundAmount = Math.abs(delta);
            finalTxnId = await walletService.createTransaction({
                debitAccountId: escrowAccount,
                creditAccountId: card.walletAccountId,
                amount: refundAmount,
                description: `Transit fare refund: ${journey.boardingStopName} → ${alightingStop.name}`,
                metadata: { journeyId: journey.journeyId, type: 'FARE_REFUND' }
            });
        }
        // delta === 0: pre-auth was exact, nothing more to do

        // 4. Close journey
        await JourneyModel.updateOne(
            { journeyId: journey.journeyId },
            {
                alightingStopId: alightingStop.stopId,
                alightingStopName: alightingStop.name,
                alightingStopSequence: alightingStop.sequence,
                alightedAt: new Date(),
                alightedByDeviceId: deviceId,
                fare: {
                    baseFare: actualFare,
                    preAuthAmount,
                    finalCharge: actualFare,
                    refundAmount
                },
                transactionId: finalTxnId,
                status: JourneyStatus.CLOSED
            }
        );

        // 5. Update card totals
        await TransitCardModel.updateOne(
            { cardId: card.cardId },
            {
                $inc: { totalTrips: 1, totalSpent: actualFare },
                lastUsedAt: new Date()
            }
        );

        // 6. Update trip revenue
        await TripModel.updateOne(
            { tripId },
            { $inc: { revenue: actualFare } }
        );

        // 7. Release any pre-booked seat reservations for this user on this trip
        await BookingService.releaseSeatsOnJourneyClose(card.userId, tripId).catch(() => null);

        const wallet = await AccountModel.findOne({ accountId: card.walletAccountId });

        return {
            journeyId: journey.journeyId,
            boardingStop: journey.boardingStopName,
            alightingStop: alightingStop.name,
            actualFare,
            preAuthAmount,
            refundAmount,
            finalCharge: actualFare,
            walletBalance: wallet?.balance ?? 0,
            message: `Alighted at ${alightingStop.name}. Fare: GHS ${(actualFare / 100).toFixed(2)}`
        };
    }

    /**
     * Check if a card has an open journey (for display on conductor device).
     */
    async getTapStatus(cardUid: string, tenantId: string) {
        const card = await TransitCardModel.findOne({ cardUid, tenantId });
        if (!card) return { hasOpenJourney: false, card: null };

        const openJourney = await JourneyModel.findOne({
            cardId: card.cardId,
            status: JourneyStatus.OPEN
        });

        return {
            hasOpenJourney: !!openJourney,
            card: { cardId: card.cardId, cardNumber: card.cardNumber, userId: card.userId },
            journey: openJourney
                ? {
                    journeyId: openJourney.journeyId,
                    boardingStop: openJourney.boardingStopName,
                    boardedAt: openJourney.boardedAt,
                    preAuthAmount: openJourney.fare.preAuthAmount
                }
                : null
        };
    }

    // ─── Wallet QR Tap Methods ──────────────────────────────────────────────

    /**
     * TAP ON BY WALLET QR — same as tapOn but uses walletAccountId directly
     * instead of looking up a transit card. The cardId field is set to a
     * virtual identifier "QR-WALLET:<walletAccountId>" so journeys opened
     * via QR scans are distinguishable from NFC journeys.
     */
    async tapOnByWallet(input: {
        userId: string;
        walletAccountId: string;
        tripId: string;
        stopId: string;
        deviceId: string;
        tenantId: string;
    }) {
        const { userId, walletAccountId, tripId, stopId, deviceId, tenantId } = input;
        const virtualCardId = `QR-WALLET:${walletAccountId}`;

        // 1. Check for open journey (prevent double boarding)
        const openJourney = await JourneyModel.findOne({ cardId: virtualCardId, status: JourneyStatus.OPEN });
        if (openJourney) {
            throw new Error('You already have an active journey. Please tap off first.');
        }

        // 2. Resolve trip + boarding stop
        const trip = await TripModel.findOne({ tripId, tenantId });
        if (!trip) throw new Error('Trip not found');

        // For journeys without specific stop (conductor didn't scan), use last stop to charge full fare
        // This handles: no stopId provided, or stopId not found on this trip's route
        let boardingStop = trip.stops.find(s => s.stopId === stopId);
        
        if (!boardingStop) {
            if (trip.stops.length === 0) {
                // Point-to-point route with no stops defined - use virtual departure
                boardingStop = { 
                    stopId: 'DEPARTURE', 
                    name: 'Departure', 
                    sequence: 0,
                    branchId: '',
                    location: { type: 'Point', coordinates: [0, 0] },
                    estimatedArrivalMinutes: 0
                } as any;
            } else {
                // No valid stopId provided — fall through to last stop for full fare
                const sortedStops = [...trip.stops].sort((a, b) => b.sequence - a.sequence);
                boardingStop = sortedStops[0];
            }
        }

        if (!boardingStop) throw new Error('Unable to resolve boarding stop');

        // 3. Check for pre-booked tickets at this stop before opening a new journey
        const currentStopSequence = boardingStop.sequence;
        const preBookedTickets = await BookingService.getPreBookedTickets(userId, tripId, currentStopSequence);

        if (preBookedTickets.length > 0) {
            // Mark all matching bookings as CHECKED_IN
            const bookingIds = [...new Set(preBookedTickets.map(t => t.bookingId))];
            for (const bookingId of bookingIds) {
                await BookingService.checkInBooking(bookingId, deviceId).catch(() => null);
            }
            return {
                action: 'PREBOOKED' as const,
                tickets: preBookedTickets,
                passenger: { userId },
                via: 'WALLET_QR',
                message: `${preBookedTickets.length} pre-booked seat(s) confirmed — no fare deducted`,
            };
        }

        // 4. Pre-auth amount
        const preAuthAmount = await this.resolvePreAuthAmount(trip.routeId, boardingStop.sequence, trip.stops);

        // 5. Check wallet balance
        const wallet = await AccountModel.findOne({ accountId: walletAccountId });
        if (!wallet) throw new Error('Wallet not found');
        if (wallet.balance < preAuthAmount) {
            throw new Error(`Insufficient balance. Minimum fare is GHS ${(preAuthAmount / 100).toFixed(2)}`);
        }

        // 6. Pre-auth: debit wallet → operator escrow
        const escrowAccount = await this.resolveOperatorEscrow(trip.operatorId, tenantId);
        const txnId = await walletService.createTransaction({
            debitAccountId: walletAccountId,
            creditAccountId: escrowAccount,
            amount: preAuthAmount,
            description: `Transit pre-auth (QR): boarding at ${boardingStop.name}`,
            metadata: { cardId: virtualCardId, tripId, stopId, type: 'PRE_AUTH', via: 'WALLET_QR' }
        });

        // 7. Create Journey
        const journey = await JourneyModel.create({
            journeyId: `JRN-${randomUUID()}`,
            cardId: virtualCardId,
            cardUid: `QR:${walletAccountId.slice(-8)}`,
            userId,
            tripId,
            routeId: trip.routeId,
            vehicleId: trip.vehicleId,
            tenantId,
            boardingStopId: boardingStop.stopId, // Use resolved stop, not input (which could be empty)
            boardingStopName: boardingStop.name,
            boardingStopSequence: boardingStop.sequence,
            boardedAt: new Date(),
            boardedByDeviceId: deviceId,
            fare: {
                baseFare: preAuthAmount,
                preAuthAmount,
                finalCharge: 0,
                refundAmount: 0
            },
            walletAccountId,
            transactionId: txnId,
            status: JourneyStatus.OPEN
        });

        return {
            action: 'TAP_ON' as const,
            journeyId: journey.journeyId,
            passenger: { userId },
            boardingStop: boardingStop.name,
            preAuthAmount,
            walletBalance: wallet.balance - preAuthAmount,
            via: 'WALLET_QR',
            message: `Boarded at ${boardingStop.name} (QR). Pre-auth: GHS ${(preAuthAmount / 100).toFixed(2)}`
        };
    }

    /**
     * TAP OFF BY WALLET QR — closes an open journey opened via wallet QR.
     */
    async tapOffByWallet(input: {
        userId: string;
        walletAccountId: string;
        tripId: string;
        stopId: string;
        deviceId: string;
        tenantId: string;
    }) {
        const { userId, walletAccountId, tripId, stopId, deviceId, tenantId } = input;
        const virtualCardId = `QR-WALLET:${walletAccountId}`;

        // 1. Find open journey
        const journey = await JourneyModel.findOne({ cardId: virtualCardId, status: JourneyStatus.OPEN });
        if (!journey) throw new Error('No active journey found for this wallet');

        if (journey.tripId !== tripId) {
            throw new Error('Wallet was boarded on a different trip. Contact staff.');
        }

        // 2. Resolve alighting stop
        const trip = await TripModel.findOne({ tripId, tenantId });
        if (!trip) throw new Error('Trip not found');

        // For tap-off without specific stop, use last stop (destination) for full fare
        let alightingStop = trip.stops.find(s => s.stopId === stopId);

        if (!alightingStop) {
            if (trip.stops.length === 0) {
                // Point-to-point route with no stops - use virtual destination
                alightingStop = { stopId: 'DESTINATION', name: 'Destination', sequence: 1, branchId: '', location: { type: 'Point', coordinates: [0, 0] }, estimatedArrivalMinutes: 60 } as any;
            } else {
                // No valid stopId provided — fall through to last stop for full fare
                const sortedStops = [...trip.stops].sort((a, b) => b.sequence - a.sequence);
                alightingStop = sortedStops[0];
            }
        }

        if (!alightingStop) throw new Error('Unable to resolve alighting stop');

        // Only enforce ordering for routes that actually have defined stops
        if (trip.stops.length > 0 && alightingStop.sequence <= journey.boardingStopSequence) {
            throw new Error('Alighting stop must be after boarding stop');
        }

        // 3. Calculate actual fare (falls back to route.basePrice when no fare matrix)
        const actualFare = await this.resolveFare(trip.routeId, journey.boardingStopId, alightingStop.stopId);
        const preAuthAmount = journey.fare.preAuthAmount;
        const delta = actualFare - preAuthAmount;
        const escrowAccount = await this.resolveOperatorEscrow(trip.operatorId, tenantId);

        let finalTxnId = journey.transactionId;
        let refundAmount = 0;

        if (delta > 0) {
            const wallet = await AccountModel.findOne({ accountId: walletAccountId });
            if (!wallet || wallet.balance < delta) {
                const available = wallet?.balance ?? 0;
                if (available > 0) {
                    finalTxnId = await walletService.createTransaction({
                        debitAccountId: walletAccountId,
                        creditAccountId: escrowAccount,
                        amount: available,
                        description: `Transit partial fare (QR): ${journey.boardingStopName} → ${alightingStop.name}`,
                        metadata: { journeyId: journey.journeyId, type: 'FARE_TOPUP', partial: true, via: 'WALLET_QR' }
                    });
                }
            } else {
                finalTxnId = await walletService.createTransaction({
                    debitAccountId: walletAccountId,
                    creditAccountId: escrowAccount,
                    amount: delta,
                    description: `Transit fare (QR): ${journey.boardingStopName} → ${alightingStop.name}`,
                    metadata: { journeyId: journey.journeyId, type: 'FARE_TOPUP', via: 'WALLET_QR' }
                });
            }
        } else if (delta < 0) {
            refundAmount = Math.abs(delta);
            finalTxnId = await walletService.createTransaction({
                debitAccountId: escrowAccount,
                creditAccountId: walletAccountId,
                amount: refundAmount,
                description: `Transit fare refund (QR): ${journey.boardingStopName} → ${alightingStop.name}`,
                metadata: { journeyId: journey.journeyId, type: 'FARE_REFUND', via: 'WALLET_QR' }
            });
        }

        // 4. Close journey
        await JourneyModel.updateOne(
            { journeyId: journey.journeyId },
            {
                alightingStopId: alightingStop.stopId,
                alightingStopName: alightingStop.name,
                alightingStopSequence: alightingStop.sequence,
                alightedAt: new Date(),
                alightedByDeviceId: deviceId,
                fare: {
                    baseFare: actualFare,
                    preAuthAmount,
                    finalCharge: actualFare,
                    refundAmount
                },
                transactionId: finalTxnId,
                status: JourneyStatus.CLOSED
            }
        );

        // 5. Update trip revenue
        await TripModel.updateOne(
            { tripId },
            { $inc: { revenue: actualFare } }
        );

        // 6. Release any pre-booked seat reservations for this user on this trip
        await BookingService.releaseSeatsOnJourneyClose(userId, tripId).catch(() => null);

        const wallet = await AccountModel.findOne({ accountId: walletAccountId });

        return {
            journeyId: journey.journeyId,
            boardingStop: journey.boardingStopName,
            alightingStop: alightingStop.name,
            actualFare,
            preAuthAmount,
            refundAmount,
            finalCharge: actualFare,
            walletBalance: wallet?.balance ?? 0,
            via: 'WALLET_QR',
            message: `Alighted at ${alightingStop.name} (QR). Fare: GHS ${(actualFare / 100).toFixed(2)}`
        };
    }

    /**
     * Orphan sweeper — close all journeys that have been OPEN past the window.
     * Called by a scheduled job (e.g. after each trip completes, or nightly cron).
     */
    async closeOrphanedJourneys(tripId?: string) {
        const cutoff = new Date(Date.now() - ORPHAN_WINDOW_MS);
        const filter: any = {
            status: JourneyStatus.OPEN,
            boardedAt: { $lt: cutoff }
        };
        if (tripId) filter.tripId = tripId;

        const orphans = await JourneyModel.find(filter);
        const results = [];

        for (const journey of orphans) {
            try {
                const trip = await TripModel.findOne({ tripId: journey.tripId });
                if (!trip) continue;

                // Charge max fare: last stop on the route (or route base price for no-stop routes)
                const lastStop = trip.stops.length > 0
                    ? [...trip.stops].sort((a, b) => b.sequence - a.sequence)[0]
                    : null;
                const toStopId = lastStop?.stopId ?? 'DESTINATION';
                const maxFare = await this.resolveFare(journey.routeId, journey.boardingStopId, toStopId)
                    .catch(() => journey.fare.preAuthAmount); // fallback to pre-auth if no fare defined

                const escrowAccount = await this.resolveOperatorEscrow(trip.operatorId, journey.tenantId);
                const delta = maxFare - journey.fare.preAuthAmount;

                if (delta > 0) {
                    const wallet = await AccountModel.findOne({ accountId: journey.walletAccountId });
                    if (wallet && wallet.balance >= delta) {
                        await walletService.createTransaction({
                            debitAccountId: journey.walletAccountId,
                            creditAccountId: escrowAccount,
                            amount: delta,
                            description: `Orphan fare: no tap-off recorded`,
                            metadata: { journeyId: journey.journeyId, type: 'ORPHAN_CHARGE' }
                        });
                    }
                }

                await JourneyModel.updateOne(
                    { journeyId: journey.journeyId },
                    {
                        status: JourneyStatus.ORPHANED,
                        orphanedAt: new Date(),
                        orphanedReason: tripId ? 'Trip completed without tap-off' : 'Orphan window exceeded',
                        ...(lastStop ? { alightingStopName: lastStop.name } : {}),
                        fare: {
                            ...journey.fare,
                            finalCharge: maxFare,
                            refundAmount: 0
                        }
                    }
                );

                results.push({ journeyId: journey.journeyId, maxFare, status: 'ORPHANED' });
            } catch (err: any) {
                results.push({ journeyId: journey.journeyId, error: err.message });
            }
        }

        return results;
    }

    // ─── Private Helpers ─────────────────────────────────────────────────────

    private async resolveFare(routeId: string, fromStopId: string, toStopId: string): Promise<number> {
        const pricing = await RoutePricingModel.findOne({ routeId, isActive: true }).sort({ effectiveFrom: -1 });

        if (pricing) {
            const fareEntry = pricing.fares.find(
                f => f.fromStopId === fromStopId && f.toStopId === toStopId
            );
            if (fareEntry) return fareEntry.price;

            // Fallback: try reverse direction (shouldn't normally happen, but safe)
            const reverseFare = pricing.fares.find(
                f => f.fromStopId === toStopId && f.toStopId === fromStopId
            );
            if (reverseFare) return reverseFare.price;
        }

        // No fare matrix entry — use route base price (covers trips with no stops)
        const route = await RouteModel.findOne({ routeId });
        if (route?.basePrice) return route.basePrice;

        throw new Error(`No fare defined for this journey`);
    }

    private async resolvePreAuthAmount(
        routeId: string,
        boardingSequence: number,
        allStops: any[]
    ): Promise<number> {
        const pricing = await RoutePricingModel.findOne({ routeId, isActive: true }).sort({ effectiveFrom: -1 });

        if (pricing && pricing.fares.length) {
            // Find the cheapest fare available from this boarding stop to any subsequent stop
            const boardingStop = allStops.find(s => s.sequence === boardingSequence);
            if (!boardingStop) return pricing.fares[0]?.price ?? 100;

            const nextStop = allStops
                .filter(s => s.sequence > boardingSequence)
                .sort((a, b) => a.sequence - b.sequence)[0];

            if (!nextStop) return pricing.fares[0]?.price ?? 100;

            const minFare = pricing.fares.find(
                f => f.fromStopId === boardingStop.stopId && f.toStopId === nextStop.stopId
            );

            return minFare?.price ?? pricing.fares[0]?.price ?? 100;
        }

        // No pricing matrix — use route base price (covers trips with no intermediate stops)
        const route = await RouteModel.findOne({ routeId });
        return route?.basePrice ?? 100;
    }

    private async resolveOperatorEscrow(operatorId: string, tenantId: string): Promise<string> {
        const escrow = await AccountModel.findOne({
            ownerId: operatorId,
            type: '2100' // LIABILITY_OPERATOR_ESCROW
        });

        if (escrow) return escrow.accountId;

        // Auto-create escrow account if missing (first-time setup)
        const walletSvc = new WalletService();
        return walletSvc.createAccount(operatorId, '2100');
    }

    /**
     * Generate a truly random, non-sequential card number.
     * Format: TG-XXXXXXXX where X is an uppercase alphanumeric character.
     * Retries up to 5 times on the rare collision chance (~1 in 2.8 billion).
     */
    private async generateUniqueCardNumber(): Promise<string> {
        const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omit ambiguous I, O, 0, 1
        const LENGTH = 8;

        for (let attempt = 0; attempt < 5; attempt++) {
            const bytes = randomBytes(LENGTH);
            const number = Array.from(bytes)
                .map(b => CHARS[b % CHARS.length])
                .join('');
            const cardNumber = `TG-${number}`;

            const clash = await TransitCardModel.findOne({ cardNumber }).select('_id').lean();
            if (!clash) return cardNumber;
        }

        // Astronomically unlikely, but fail safely
        throw new Error('Could not generate a unique card number. Please try again.');
    }
}
