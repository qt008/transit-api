import { FastifyInstance } from 'fastify';
import { TransitController, RegisterCardSchema, TapOnSchema, TapOffSchema, SweepSchema, WalletQRTapSchema, ScanQRSchema } from './controllers/transit.controller';
import { validateBody } from '../../shared/kernel/validate.middleware';
import { requireAnyRole } from '../../shared/kernel/permission.middleware';
import { Role } from '../identity/models/user.model';

const CONDUCTORS = [Role.DRIVER, Role.INSPECTOR];
const CONDUCTORS_AND_ADMIN = [Role.DRIVER, Role.INSPECTOR, Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];

export async function transitRoutes(fastify: FastifyInstance) {

    // ── Passenger: NFC card self-management ───────────────────────────────────
    fastify.post('/cards/register', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.PASSENGER]), validateBody(RegisterCardSchema)]
    }, TransitController.registerCard);

    fastify.get('/cards/my-cards', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.PASSENGER])]
    }, TransitController.getMyCards);

    // ── Conductor device: tap-on / tap-off ────────────────────────────────────
    fastify.post('/tap-on', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS), validateBody(TapOnSchema)]
    }, TransitController.tapOn);

    fastify.post('/tap-off', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS), validateBody(TapOffSchema)]
    }, TransitController.tapOff);

    fastify.get('/tap-status/:cardUid', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS_AND_ADMIN)]
    }, TransitController.getTapStatus);

    fastify.post('/wallet-qr/tap-on', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS), validateBody(WalletQRTapSchema)]
    }, TransitController.walletQRTapOn);

    fastify.post('/wallet-qr/tap-off', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS), validateBody(WalletQRTapSchema)]
    }, TransitController.walletQRTapOff);

    // Unified QR scan — primary conductor action (validates wallet QR or ticket QR)
    fastify.post('/scan', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS), validateBody(ScanQRSchema)]
    }, TransitController.scanQR);

    // ── Journey manifest (conductor + admin oversight) ─────────────────────────
    fastify.get('/journeys/trip/:tripId', {
        preHandler: [fastify.authenticate, requireAnyRole(CONDUCTORS_AND_ADMIN)]
    }, TransitController.getTripJourneys);

    // ── Admin: orphan sweep after trip completion ──────────────────────────────
    fastify.post('/orphan-sweep', {
        preHandler: [fastify.authenticate, requireAnyRole([Role.SUPER_ADMIN, Role.OPERATOR_ADMIN]), validateBody(SweepSchema)]
    }, TransitController.sweepOrphans);
}
