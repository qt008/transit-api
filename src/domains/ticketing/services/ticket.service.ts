import { TicketModel, TicketStatus } from '../models/ticket.model';
import { WalletService } from '../../wallet/services/wallet.service';
import crypto from 'crypto';
import { randomUUID } from 'crypto';

export class TicketService {
    private walletService: WalletService;
    // TODO: Move to Key Management Service (KMS)
    private readonly SIGNING_KEY = process.env.TICKET_SIGNING_KEY || 'master-signing-key';

    constructor() {
        this.walletService = new WalletService();
    }

    async issueTicket(passengerId: string, tripId: string, price: number, routeId: string, walletAccountId: string) {
        // 1. Financial Transaction (Debit User)
        // Note: Escrow account ID should come from Trip/Operator lookup
        const operatorEscrowId = 'ACCT-OPERATOR-ESCROW-MOCK';

        const txnId = await this.walletService.createTransaction({
            debitAccountId: walletAccountId,
            creditAccountId: operatorEscrowId,
            amount: price,
            description: `Ticket Purchase for Trip ${tripId}`,
            metadata: { tripId, passengerId, routeId },
            idempotencyKey: `TICKET-${tripId}-${passengerId}`
        });

        // 2. Generate Crypto Artifacts
        const ticketId = `TKT-${randomUUID()}`;
        const secret = crypto.randomBytes(32).toString('hex'); // For TOTP

        // Sign the static data: ticketId + expires
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h validity
        const payload = `${ticketId}:${expiresAt.getTime()}`;
        const signature = crypto
            .createHmac('sha256', this.SIGNING_KEY)
            .update(payload)
            .digest('hex');

        // 3. Persist Ticket
        const ticket = await TicketModel.create({
            ticketId,
            passengerId,
            routeId,
            tripId,
            price,
            secret,
            signature,
            expiresAt,
            status: TicketStatus.ISSUED
        });

        return { ticket, signature, secret };
    }

    async syncOfflineValidation(ticketId: string, validatorDeviceId: string, validatedAt: Date) {
        const ticket = await TicketModel.findOne({ ticketId });
        if (!ticket) throw new Error('Ticket not found');

        if (ticket.status === TicketStatus.VALIDATED) {
            console.warn(`Duplicate sync for ticket ${ticketId}`);
            return;
        }

        ticket.status = TicketStatus.VALIDATED;
        ticket.validatedAt = validatedAt;
        ticket.validatedBy = validatorDeviceId;
        ticket.syncStatus = 'SYNCED';

        await ticket.save();
        return ticket;
    }
}
