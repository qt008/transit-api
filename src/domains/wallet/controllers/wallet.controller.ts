import { FastifyRequest, FastifyReply } from 'fastify';
import { WalletService } from '../services/wallet.service';
import { MobileMoneyService } from '../services/mobile-money.service';
import { LedgerEntryModel } from '../models/ledger-entry.model';
import { AccountModel } from '../models/account.model';
import { z } from 'zod';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';
import { MobileMoneyProvider } from '../models/mobile-money-transaction.model';

const walletService = new WalletService();
const mobileMoneyService = new MobileMoneyService();

const TopupSchema = z.object({
    provider: z.enum(['MTN', 'VODAFONE', 'AIRTELTIGO']),
    phoneNumber: z.string().regex(/^0\d{9}$/),
    amount: z.number().min(100) // Minimum 1 GHS
});

const WithdrawSchema = z.object({
    provider: z.enum(['MTN', 'VODAFONE', 'AIRTELTIGO']),
    phoneNumber: z.string().regex(/^0\d{9}$/),
    amount: z.number().min(100)
});

const TransferSchema = z.object({
    recipientWalletId: z.string(),
    amount: z.number().min(100)
});

const WebhookSchema = z.object({
    providerTransactionId: z.string(),
    status: z.enum(['success', 'failed']),
    signature: z.string()
});

export class WalletController {

    /**
     * GET /wallet/me/balance - Get my wallet balance
     */
    static async getMyBalance(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const walletId = req.user.walletAccountId;

        const account = await AccountModel.findOne({ accountId: walletId });
        if (!account) return reply.status(404).send({ error: 'Wallet not found' });

        return reply.send({
            success: true,
            data: {
                accountId: account.accountId,
                balance: account.balance,
                currency: account.currency
            }
        });
    }

    /**
     * GET /wallet/me/transactions?page=1&limit=20 - Transaction history
     */
    static async getMyTransactions(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const walletId = req.user.walletAccountId;
        const params = getPaginationParams(req);

        const [transactions, total] = await Promise.all([
            LedgerEntryModel.find({ accountId: walletId })
                .sort({ createdAt: -1 })
                .skip(params.skip)
                .limit(params.limit),
            LedgerEntryModel.countDocuments({ accountId: walletId })
        ]);

        return reply.send(createPaginatedResponse(transactions, total, params));
    }

    /**
     * POST /wallet/topup - Initiate mobile money top-up
     */
    static async topup(req: FastifyRequest, reply: FastifyReply) {
        const { provider, phoneNumber, amount } = TopupSchema.parse(req.body);
        // @ts-ignore
        const userId = req.user.id;
        // @ts-ignore
        const walletId = req.user.walletAccountId;

        try {
            const result = await mobileMoneyService.initiateTopup(
                userId,
                walletId,
                provider as MobileMoneyProvider,
                phoneNumber,
                amount
            );

            return reply.status(201).send({
                success: true,
                data: result
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /wallet/topup/callback - Webhook from provider
     */
    static async topupCallback(req: FastifyRequest, reply: FastifyReply) {
        const { providerTransactionId, status, signature } = WebhookSchema.parse(req.body);

        // Verify signature (in production)
        const isValid = mobileMoneyService.verifyWebhookSignature(
            signature,
            JSON.stringify(req.body),
            process.env.MOMO_WEBHOOK_SECRET || 'secret'
        );

        if (!isValid) {
            return reply.status(401).send({ error: 'Invalid signature' });
        }

        try {
            await mobileMoneyService.handleWebhook(
                providerTransactionId,
                status,
                req.body
            );

            return reply.send({ success: true, message: 'Webhook processed' });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /wallet/withdraw - Withdraw to mobile money
     */
    static async withdraw(req: FastifyRequest, reply: FastifyReply) {
        const { provider, phoneNumber, amount } = WithdrawSchema.parse(req.body);
        // @ts-ignore
        const userId = req.user.id;
        // @ts-ignore
        const walletId = req.user.walletAccountId;

        try {
            const result = await mobileMoneyService.initiateWithdraw(
                userId,
                walletId,
                provider as MobileMoneyProvider,
                phoneNumber,
                amount
            );

            return reply.send({
                success: true,
                data: result
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }

    /**
     * POST /wallet/transfer - P2P transfer
     */
    static async transfer(req: FastifyRequest, reply: FastifyReply) {
        const { recipientWalletId, amount } = TransferSchema.parse(req.body);
        // @ts-ignore
        const userId = req.user.id;
        // @ts-ignore
        const senderWalletId = req.user.walletAccountId;

        try {
            const result = await mobileMoneyService.transfer(
                userId,
                senderWalletId,
                recipientWalletId,
                amount
            );

            return reply.send({
                success: true,
                data: result
            });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    }
}
