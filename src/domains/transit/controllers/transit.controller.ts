import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TransitService } from '../services/transit.service';
import { TransitCardModel } from '../models/transit-card.model';
import { JourneyModel, JourneyStatus } from '../models/journey.model';
import { WalletQRService } from '../../wallet/services/wallet-qr.service';
import { TicketModel, TicketStatus } from '../../ticketing/models/ticket.model';
import { QRCodeService } from '../../ticketing/services/qrcode.service';
import { getPaginationParams } from '../../../shared/kernel/pagination.helper';

const transitService = new TransitService();

/**
 * Decode HTML entities that may be injected by QR scanner libraries or
 * WebView environments before the payload reaches the backend.
 * e.g. &quot; → "   &amp; → &   &lt; → <   &gt; → >
 */
function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/');
}

// cardUid: hex string from NFC reader, 4–14 bytes → 8–28 hex chars
const CardUidField = z.string()
    .min(8, 'Card UID too short — minimum 8 hex characters')
    .max(28, 'Card UID too long — maximum 28 hex characters')
    .regex(/^[0-9A-Fa-f]+$/, 'Card UID must be a valid hex string (0-9, A-F)');

// userId and walletAccountId are NOT accepted from the body — they are sourced from req.user (JWT)
export const RegisterCardSchema = z.object({
    cardUid: CardUidField,
    type: z.enum(['PHYSICAL_NFC', 'VIRTUAL_HCE', 'QR_ONLY']).optional()
});

export const TapOnSchema = z.object({
    cardUid: CardUidField,
    tripId: z.string().min(1, 'tripId is required'),
    stopId: z.string().min(1, 'stopId is required'),
    deviceId: z.string().min(1, 'deviceId is required')
});

export const TapOffSchema = z.object({
    cardUid: CardUidField,
    tripId: z.string().min(1, 'tripId is required'),
    stopId: z.string().min(1, 'stopId is required'),
    deviceId: z.string().min(1, 'deviceId is required')
});

export const SweepSchema = z.object({
    tripId: z.string().optional()
});

export const ValidateQRSchema = z.object({
    qrPayload: z.string().min(1, 'qrPayload is required'),
    deviceId: z.string().min(1, 'deviceId is required'),
    tripId: z.string().optional()
});

export const WalletQRTapSchema = z.object({
    qrPayload: z.string().min(1, 'qrPayload is required'),
    tripId: z.string().min(1, 'tripId is required'),
    stopId: z.string().optional(),
    deviceId: z.string().min(1, 'deviceId is required'),
});

/**
 * Unified scan schema — covers both ticket QR and wallet QR.
 * stopId is optional because ticket validation doesn't require it,
 * but wallet QR boarding does. The handler enforces it contextually.
 */
export const ScanQRSchema = z.object({
    qrPayload: z.string().min(1, 'qrPayload is required'),
    tripId: z.string().min(1, 'tripId is required'),
    stopId: z.string().optional(),
    deviceId: z.string().min(1, 'deviceId is required'),
});

export class TransitController {

    /**
     * POST /transit/register-card
     * Link an NFC card UID to the authenticated passenger's account.
     * userId and walletAccountId are always resolved from the JWT — never from the body.
     */
    static async registerCard(req: FastifyRequest, reply: FastifyReply) {
        const body = RegisterCardSchema.parse(req.body);

        // @ts-ignore
        const user = req.user as { id: string; tenantId: string; walletAccountId: string };
        if (!user?.id) return reply.status(401).send({ success: false, error: 'Authentication required' });
        if (!user?.walletAccountId) {
            return reply.status(400).send({
                success: false,
                error: 'No wallet account linked to your profile. Please contact support.'
            });
        }

        try {
            const card = await transitService.registerCard({
                cardUid: body.cardUid,
                userId: user.id,
                walletAccountId: user.walletAccountId,
                tenantId: user.tenantId,
                type: body.type
            });
            return reply.status(201).send({
                success: true,
                data: {
                    cardId: card.cardId,
                    cardNumber: card.cardNumber,
                    cardUid: card.cardUid,
                    status: card.status,
                    expiresAt: card.expiresAt
                }
            });
        } catch (err: any) {
            const isDuplicate = err.code === 11000 || err.message.includes('already registered');
            return reply.status(isDuplicate ? 409 : 400).send({ success: false, error: err.message });
        }
    }

    /**
     * POST /transit/tap-on
     * Passenger boards bus — open a journey and pre-auth minimum fare.
     */
    static async tapOn(req: FastifyRequest, reply: FastifyReply) {
        const body = TapOnSchema.parse(req.body);
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        try {
            const result = await transitService.tapOn({ ...body, tenantId });
            return reply.send({ success: true, data: result });
        } catch (err: any) {
            const statusCode = err.message.includes('not found') ? 404 : 400;
            return reply.status(statusCode).send({ success: false, error: err.message });
        }
    }

    /**
     * POST /transit/tap-off
     * Passenger alights — close journey, charge actual fare, refund if applicable.
     */
    static async tapOff(req: FastifyRequest, reply: FastifyReply) {
        const body = TapOffSchema.parse(req.body);
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        try {
            const result = await transitService.tapOff({ ...body, tenantId });
            return reply.send({ success: true, data: result });
        } catch (err: any) {
            const statusCode = err.message.includes('not found') ? 404 : 400;
            return reply.status(statusCode).send({ success: false, error: err.message });
        }
    }

    /**
     * GET /transit/tap-status/:cardUid
     * Check if a card currently has an open journey (shown on conductor device before tapping).
     */
    static async getTapStatus(req: FastifyRequest, reply: FastifyReply) {
        const { cardUid } = req.params as { cardUid: string };
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        try {
            const status = await transitService.getTapStatus(cardUid, tenantId);
            return reply.send({ success: true, data: status });
        } catch (err: any) {
            return reply.status(400).send({ success: false, error: err.message });
        }
    }

    /**
     * GET /transit/cards/my-cards?page=1&limit=20&status=ACTIVE
     * Passenger's registered NFC cards — paginated aggregation pipeline.
     * Uses $facet to return data + total count in a single DB round-trip.
     */
    static async getMyCards(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const userId = req.user?.id;
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        const { status } = req.query as { status?: string };
        const params = getPaginationParams(req);

        const matchStage: Record<string, any> = { userId, tenantId };
        if (status) matchStage.status = status.toUpperCase();

        const [result] = await TransitCardModel.aggregate([
            { $match: matchStage },
            {
                $facet: {
                    data: [
                        { $sort: { issuedAt: -1 } },
                        { $skip: params.skip },
                        { $limit: params.limit },
                        {
                            $project: {
                                _id: 0,
                                cardId: 1,
                                cardNumber: 1,
                                type: 1,
                                status: 1,
                                issuedAt: 1,
                                expiresAt: 1,
                                totalTrips: 1,
                                // Convert pesewas to GHS for display
                                totalSpentGHS: { $round: [{ $divide: ['$totalSpent', 100] }, 2] },
                                lastUsedAt: 1
                            }
                        }
                    ],
                    totalCount: [{ $count: 'count' }]
                }
            },
            {
                $project: {
                    data: 1,
                    total: { $ifNull: [{ $arrayElemAt: ['$totalCount.count', 0] }, 0] }
                }
            }
        ]);

        const total = result?.total ?? 0;
        const totalPages = Math.ceil(total / params.limit);

        return reply.send({
            success: true,
            data: result?.data ?? [],
            pagination: {
                page: params.page,
                limit: params.limit,
                total,
                totalPages,
                hasNextPage: params.page < totalPages,
                hasPrevPage: params.page > 1
            }
        });
    }

    /**
     * POST /transit/orphan-sweep
     * Manually trigger orphan journey sweep for a completed trip.
     * Called when a trip's status changes to COMPLETED.
     */
    static async sweepOrphans(req: FastifyRequest, reply: FastifyReply) {
        const { tripId } = req.body as { tripId?: string };

        try {
            const results = await transitService.closeOrphanedJourneys(tripId);
            return reply.send({
                success: true,
                data: { processed: results.length, results }
            });
        } catch (err: any) {
            return reply.status(500).send({ success: false, error: err.message });
        }
    }

    /**
     * GET /transit/journeys/trip/:tripId
     * All journeys for a trip — for conductor stats and post-trip audit.
     */
    static async getTripJourneys(req: FastifyRequest, reply: FastifyReply) {
        const { tripId } = req.params as { tripId: string };

        const journeys = await JourneyModel.find({ tripId })
            .sort({ boardedAt: -1 })
            .lean();

        const stats = {
            total: journeys.length,
            open: journeys.filter(j => j.status === JourneyStatus.OPEN).length,
            closed: journeys.filter(j => j.status === JourneyStatus.CLOSED).length,
            orphaned: journeys.filter(j => j.status === JourneyStatus.ORPHANED).length,
            totalRevenue: journeys.reduce((sum, j) => sum + (j.fare.finalCharge || 0), 0)
        };

        return reply.send({ success: true, data: { stats, journeys } });
    }

    /**
     * POST /transit/wallet-qr/tap-on
     * Conductor scanned a wallet QR — open a journey using the wallet directly.
     */
    static async walletQRTapOn(req: FastifyRequest, reply: FastifyReply) {
        const body = WalletQRTapSchema.parse(req.body);
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';
        try {
            const verified = await WalletQRService.verifyPayload(decodeHtmlEntities(body.qrPayload));
            const result = await transitService.tapOnByWallet({
                userId: verified.userId,
                walletAccountId: verified.walletAccountId,
                tripId: body.tripId,
                stopId: body.stopId ?? '',
                deviceId: body.deviceId,
                tenantId,
            });
            return reply.send({ success: true, data: result });
        } catch (err: any) {
            const statusCode = err.message.includes('not found') ? 404 : 400;
            return reply.status(statusCode).send({ success: false, error: err.message });
        }
    }

    /**
     * POST /transit/wallet-qr/tap-off
     * Conductor scanned a wallet QR — close the journey.
     */
    static async walletQRTapOff(req: FastifyRequest, reply: FastifyReply) {
        const body = WalletQRTapSchema.parse(req.body);
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        try {
            const verified = await WalletQRService.verifyPayload(decodeHtmlEntities(body.qrPayload));
            const result = await transitService.tapOffByWallet({
                userId: verified.userId,
                walletAccountId: verified.walletAccountId,
                tripId: body.tripId,
                stopId: body.stopId ?? '',
                deviceId: body.deviceId,
                tenantId,
            });
            return reply.send({ success: true, data: result });
        } catch (err: any) {
            const statusCode = err.message.includes('not found') ? 404 : 400;
            return reply.status(statusCode).send({ success: false, error: err.message });
        }
    }

    /**
     * POST /transit/scan
     * Unified QR scanning endpoint for conductor devices (both modes).
     *
     * Auto-detects QR type from the payload:
     *   - { type: "WALLET", ... }  → wallet tap-on / auto-toggle tap-off
     *   - { ticketId, signature, expiresAt }  → ticket validation
     *
     * Returns a normalised response so the device never needs to
     * branch on QR type:
     *   { success, type, action, result, message, data }
     */
    static async scanQR(req: FastifyRequest, reply: FastifyReply) {
        const raw = ScanQRSchema.parse(req.body);
        // @ts-ignore
        const tenantId = req.user?.tenantId || 'default';

        // Decode HTML entities that QR scanner libraries sometimes inject
        // (&quot; → ", &amp; → &, etc.) before any JSON parsing or HMAC verification
        const qrPayload = decodeHtmlEntities(raw.qrPayload);
        const { tripId, stopId, deviceId } = raw;
        let parsed: any;
        try {
            parsed = JSON.parse(qrPayload);
        } catch {
            return reply.status(400).send({
                success: false, type: 'UNKNOWN', result: 'INVALID',
                error: 'Invalid QR — payload is not valid JSON'
            });
        }

        // ── Wallet QR ─────────────────────────────────────────────────────────
        if (parsed.type === 'WALLET') {
            let verified: { userId: string; walletAccountId: string };
            try {
                verified = await WalletQRService.verifyPayload(qrPayload);
            } catch (err: any) {
                return reply.status(400).send({
                    success: false, type: 'WALLET', result: 'INVALID',
                    error: err.message || 'Invalid or expired wallet QR'
                });
            }

            // Try tap-on; if passenger already has an open journey on this trip → tap-off
            try {
                const result = await transitService.tapOnByWallet({
                    userId: verified.userId,
                    walletAccountId: verified.walletAccountId,
                    tripId, stopId: stopId ?? '', deviceId, tenantId
                });
                return reply.send({
                    success: true, type: 'WALLET', action: 'TAP_ON', result: 'VALID',
                    message: result.message || 'Journey started — welcome aboard',
                    data: result
                });
            } catch (tapOnErr: any) {
                if (tapOnErr.message?.toLowerCase().includes('active journey')) {
                    try {
                        const result = await transitService.tapOffByWallet({
                            userId: verified.userId,
                            walletAccountId: verified.walletAccountId,
                            tripId, stopId: stopId ?? '', deviceId, tenantId
                        });
                        return reply.send({
                            success: true, type: 'WALLET', action: 'TAP_OFF', result: 'VALID',
                            message: result.message || 'Journey closed — goodbye',
                            data: result
                        });
                    } catch (tapOffErr: any) {
                        return reply.status(400).send({
                            success: false, type: 'WALLET', action: 'TAP_OFF', result: 'INVALID',
                            error: tapOffErr.message
                        });
                    }
                }
                return reply.status(400).send({
                    success: false, type: 'WALLET', action: 'TAP_ON', result: 'INVALID',
                    error: tapOnErr.message
                });
            }
        }

        // ── Ticket QR ─────────────────────────────────────────────────────────
        try {
            if (!parsed.ticketId || !parsed.signature) {
                throw new Error('Unrecognised QR format — missing ticketId or signature');
            }

            const ticket = await TicketModel.findOne({ ticketId: parsed.ticketId });
            if (!ticket) throw new Error('Ticket not found');

            const isValid = QRCodeService.verifyTicketSignature(
                ticket.ticketId, ticket.userId, ticket.routeId,
                ticket.price, ticket.expiresAt, parsed.signature
            );
            if (!isValid) throw new Error('Invalid ticket — signature mismatch');

            if (QRCodeService.isExpired(ticket.expiresAt)) {
                ticket.status = TicketStatus.EXPIRED;
                await ticket.save();
                return reply.status(400).send({
                    success: false, type: 'TICKET', action: 'VALIDATE', result: 'EXPIRED',
                    error: 'Ticket has expired'
                });
            }

            if (ticket.status === TicketStatus.USED || ticket.status === TicketStatus.CANCELLED) {
                return reply.status(400).send({
                    success: false, type: 'TICKET', action: 'VALIDATE',
                    result: ticket.status === TicketStatus.USED ? 'USED' : 'INVALID',
                    error: `Ticket is ${ticket.status.toLowerCase()}`
                });
            }

            if (tripId && ticket.tripId && ticket.tripId !== tripId) {
                return reply.status(400).send({
                    success: false, type: 'TICKET', action: 'VALIDATE', result: 'INVALID',
                    error: 'Ticket is not valid for this trip'
                });
            }

            ticket.status = TicketStatus.VALIDATED;
            ticket.validatedAt = new Date();
            ticket.validatedBy = deviceId;
            ticket.syncStatus = 'SYNCED';
            await ticket.save();

            return reply.send({
                success: true, type: 'TICKET', action: 'VALIDATE', result: 'VALID',
                message: 'Ticket valid — passenger may board',
                data: {
                    ticketId: ticket.ticketId,
                    userId: ticket.userId,
                    routeId: ticket.routeId,
                    price: ticket.price,
                    validatedAt: ticket.validatedAt
                }
            });
        } catch (err: any) {
            return reply.status(400).send({
                success: false, type: 'TICKET', action: 'VALIDATE', result: 'INVALID',
                error: err.message
            });
        }
    }
}
