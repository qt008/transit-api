import { FastifyInstance } from 'fastify';
import { TransitController, RegisterCardSchema, TapOnSchema, TapOffSchema, SweepSchema, WalletQRTapSchema, ScanQRSchema } from './controllers/transit.controller';
import { validateBody } from '../../shared/kernel/validate.middleware';

export async function transitRoutes(fastify: FastifyInstance) {

    // Card management — passengers register their NFC cards
    fastify.post('/cards/register', {
        preHandler: [fastify.authenticate, validateBody(RegisterCardSchema)]
    }, TransitController.registerCard);
    fastify.get('/cards/my-cards', { preHandler: [fastify.authenticate] }, TransitController.getMyCards);

    // Tap-on / Tap-off — called by conductor device (device has its own JWT)
    fastify.post('/tap-on', {
        preHandler: [fastify.authenticate, validateBody(TapOnSchema)]
    }, TransitController.tapOn);
    fastify.post('/tap-off', {
        preHandler: [fastify.authenticate, validateBody(TapOffSchema)]
    }, TransitController.tapOff);
    fastify.get('/tap-status/:cardUid', { preHandler: [fastify.authenticate] }, TransitController.getTapStatus);

    // Wallet QR tap — conductor scans passenger's wallet QR code
    fastify.post('/wallet-qr/tap-on', {
        preHandler: [fastify.authenticate, validateBody(WalletQRTapSchema)]
    }, TransitController.walletQRTapOn);
    fastify.post('/wallet-qr/tap-off', {
        preHandler: [fastify.authenticate, validateBody(WalletQRTapSchema)]
    }, TransitController.walletQRTapOff);

    // Unified QR scan — auto-detects wallet vs ticket, conductor device uses this for everything
    fastify.post('/scan', {
        preHandler: [fastify.authenticate, validateBody(ScanQRSchema)]
    }, TransitController.scanQR);

    // Journey management
    fastify.get('/journeys/trip/:tripId', { preHandler: [fastify.authenticate] }, TransitController.getTripJourneys);

    // Orphan sweep — internal/admin use, called after trip completion
    fastify.post('/orphan-sweep', {
        preHandler: [fastify.authenticate, validateBody(SweepSchema)]
    }, TransitController.sweepOrphans);
}
