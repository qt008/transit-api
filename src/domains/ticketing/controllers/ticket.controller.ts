import { FastifyRequest, FastifyReply } from 'fastify';
import { TicketModel, TicketStatus } from '../models/ticket.model';
import { WalletService } from '../../wallet/services/wallet.service';
import { QRCodeService } from '../services/qrcode.service';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';

const walletService = new WalletService();

const PurchaseTicketSchema = z.object({
    routeId: z.string(),
    tripId: z.string().optional()
});

const ValidateTicketSchema = z.object({
    ticketId: z.string(),
    signature: z.string()
});

export class TicketController {

    /**
     * POST /tickets/purchase - Purchase ticket with route access check
     */
    static async purchase(req: FastifyRequest, reply: FastifyReply) {
        const { routeId, tripId } = PurchaseTicketSchema.parse(req.body);
        // @ts-ignore
        const userId = req.user.id;
        // @ts-ignore
        const walletId = req.user.walletAccountId;
        // @ts-ignore - Added by checkRouteAccess middleware
        const route = (req as any).route;

        try {
            const price = route.basePrice; // In pesewas
            const ticketId = `TKT-${randomUUID()}`;

            // 1. Deduct from wallet
            await walletService.debitWallet(
                walletId,
                price,
                `Ticket purchase - ${route.name}`,
                { ticketId, routeId }
            );

            // 2. Generate QR code
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h validity
            const { qrCode, signature, secret } = await QRCodeService.generateTicketQR({
                ticketId,
                userId,
                routeId,
                price,
                expiresAt
            });

            // 3. Create ticket
            const ticket = await TicketModel.create({
                ticketId,
                userId,
                routeId,
                tripId,
                qrCode,
                price,
                signature,
                secret,
                expiresAt,
                status: TicketStatus.ISSUED
            });

            return reply.status(201).send({
                success: true,
                data: {
                    ticketId: ticket.ticketId,
                    qrCode: ticket.qrCode,
                    price: ticket.price,
                    expiresAt: ticket.expiresAt,
                    status: ticket.status
                }
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * GET /tickets/my-tickets?status=active - Get user's tickets
     */
    static async getMyTickets(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const userId = req.user.id;
        const { status } = req.query as any;
        const params = getPaginationParams(req);

        const filter: any = { userId };
        if (status === 'active') {
            filter.status = { $in: [TicketStatus.ISSUED, TicketStatus.VALIDATED] };
            filter.expiresAt = { $gt: new Date() };
        } else if (status) {
            filter.status = status;
        }

        const [tickets, total] = await Promise.all([
            TicketModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(params.skip)
                .limit(params.limit),
            TicketModel.countDocuments(filter)
        ]);

        return reply.send(createPaginatedResponse(tickets, total, params));
    }

    /**
     * GET /tickets/:id - Get ticket details with QR
     */
    static async getTicketById(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        // @ts-ignore
        const userId = req.user.id;

        const ticket = await TicketModel.findOne({ ticketId: id, userId });
        if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

        return reply.send({
            success: true,
            data: ticket
        });
    }

    /**
     * POST /tickets/:id/validate - Driver validates ticket
     */
    static async validateTicket(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        const { signature } = ValidateTicketSchema.parse(req.body);
        // @ts-ignore
        const driverId = req.user.id;

        try {
            const ticket = await TicketModel.findOne({ ticketId: id });
            if (!ticket) throw new Error('Ticket not found');

            // Verify signature
            const isValid = QRCodeService.verifyTicketSignature(
                ticket.ticketId,
                ticket.userId,
                ticket.routeId,
                ticket.price,
                ticket.expiresAt,
                signature
            );

            if (!isValid) throw new Error('Invalid ticket signature');

            // Check expiration
            if (QRCodeService.isExpired(ticket.expiresAt)) {
                ticket.status = TicketStatus.EXPIRED;
                await ticket.save();
                throw new Error('Ticket expired');
            }

            // Check status
            if (ticket.status === TicketStatus.USED) {
                throw new Error('Ticket already used');
            }

            if (ticket.status === TicketStatus.CANCELLED) {
                throw new Error('Ticket cancelled');
            }

            // Mark as validated
            ticket.status = TicketStatus.VALIDATED;
            ticket.validatedAt = new Date();
            ticket.validatedBy = driverId;
            await ticket.save();

            return reply.send({
                success: true,
                message: 'Ticket validated successfully',
                data: {
                    ticketId: ticket.ticketId,
                    userId: ticket.userId,
                    routeId: ticket.routeId,
                    validatedAt: ticket.validatedAt
                }
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /tickets/:id/cancel - Cancel ticket with refund
     */
    static async cancelTicket(req: FastifyRequest, reply: FastifyReply) {
        const { id } = req.params as { id: string };
        // @ts-ignore
        const userId = req.user.id;

        try {
            const ticket = await TicketModel.findOne({ ticketId: id, userId });
            if (!ticket) throw new Error('Ticket not found');

            if (ticket.status !== TicketStatus.ISSUED) {
                throw new Error('Only unused tickets can be cancelled');
            }

            // Refund to wallet (80% refund policy)
            const refundAmount = Math.floor(ticket.price * 0.8);
            // @ts-ignore
            const walletId = req.user.walletAccountId;

            await walletService.creditWallet(
                walletId,
                refundAmount,
                `Ticket cancellation refund - ${ticket.ticketId}`,
                { ticketId: ticket.ticketId }
            );

            // Update ticket
            ticket.status = TicketStatus.CANCELLED;
            await ticket.save();

            return reply.send({
                success: true,
                message: 'Ticket cancelled and refunded',
                data: {
                    refundAmount,
                    refundPercentage: 80
                }
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /tickets/sync - Sync offline validations (legacy)
     */
    static async syncValidation(req: FastifyRequest, reply: FastifyReply) {
        // Legacy endpoint - kept for backward compatibility
        return reply.send({ success: true, message: 'Sync endpoint deprecated' });
    }
}
