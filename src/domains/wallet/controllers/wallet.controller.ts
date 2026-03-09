import { FastifyRequest, FastifyReply } from 'fastify';
import { WalletService } from '../services/wallet.service';
import { WalletQRService } from '../services/wallet-qr.service';
import { MobileMoneyService } from '../services/mobile-money.service';
import { LedgerEntryModel } from '../models/ledger-entry.model';
import { AccountModel } from '../models/account.model';
import { z } from 'zod';
import { getPaginationParams, createPaginatedResponse } from '../../../shared/kernel/pagination.helper';
import { MobileMoneyProvider, MobileMoneyTransactionModel } from '../models/mobile-money-transaction.model';

const walletService = new WalletService();
const mobileMoneyService = new MobileMoneyService();

export const TopupSchema = z.object({
    provider: z.enum(['MTN', 'VODAFONE', 'AIRTELTIGO']),
    phoneNumber: z.string().regex(/^0\d{9}$/, 'phoneNumber must be a 10-digit Ghanaian number starting with 0'),
    amount: z.number().min(100, 'Minimum top-up is GHS 1.00')
});

export const SimulateCallbackSchema = z.object({
    transactionId: z.string().min(1, 'transactionId is required'),
});

export const WithdrawSchema = z.object({
    provider: z.enum(['MTN', 'VODAFONE', 'AIRTELTIGO']),
    phoneNumber: z.string().regex(/^0\d{9}$/, 'phoneNumber must be a 10-digit Ghanaian number starting with 0'),
    amount: z.number().min(100, 'Minimum withdrawal is GHS 1.00')
});

export const TransferSchema = z.object({
    recipientWalletId: z.string().min(1, 'recipientWalletId is required'),
    amount: z.number().min(100, 'Minimum transfer is GHS 1.00')
});

export const WebhookSchema = z.object({
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

        let account = await AccountModel.findOne({ accountId: walletId });
        
        // Lazy create wallet if it doesn't exist (for existing users)
        if (!account && walletId) {
            // Determine account type based on user role
            // @ts-ignore
            const userRole = req.user.role;
            const isOperator = userRole === 'OPERATOR_ADMIN' || userRole === 'OPERATOR';
            const accountType = isOperator ? '2100' : '1100';
            
            const newWalletId = await walletService.createAccount(walletId, accountType as any);
            account = await AccountModel.findOne({ accountId: newWalletId });
        }
        
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
     * POST /wallet/topup/simulate-callback
     * Dev helper: instantly approves a pending top-up by calling
     * handleWebhook with status 'success'. This simulates the
     * mobile money provider approving the payment.
     */
    static async simulateTopupCallback(req: FastifyRequest, reply: FastifyReply) {
        const { transactionId } = SimulateCallbackSchema.parse(req.body);

        try {
            // Find the pending tx by our internal transactionId
            const tx = await MobileMoneyTransactionModel.findOne({ transactionId });
            if (!tx) return reply.status(404).send({ error: 'Transaction not found' });
            if (tx.callbackReceived) return reply.send({ success: true, data: { message: 'Already processed' } });

            // Simulate the provider approval
            await mobileMoneyService.handleWebhook(
                tx.providerTransactionId!,
                'success',
                { simulated: true, approvedAt: new Date().toISOString() }
            );

            // Fetch updated balance
            // @ts-ignore
            const walletId = req.user?.walletAccountId;
            let balance: number | undefined;
            if (walletId) {
                const account = await AccountModel.findOne({ accountId: walletId });
                balance = account?.balance;
            }

            return reply.send({
                success: true,
                data: {
                    message: 'Top-up approved (simulated)',
                    transactionId,
                    balance,
                }
            });
        } catch (err: any) {
            console.log("error",err)
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

    /**
     * GET /wallet/me/qr - Get signed wallet QR payload
     * Returns the JSON string that clients render as a QR code.
     */
    static async getMyWalletQR(req: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore
        const userId = req.user.id;
        // @ts-ignore
        const walletAccountId = req.user.walletAccountId;

        if (!walletAccountId) {
            return reply.status(400).send({ error: 'No wallet associated with this account' });
        }

        try {
            const qrPayload = WalletQRService.generatePayload(userId, walletAccountId);

            return reply.send({
                success: true,
                data: {
                    qrPayload,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                }
            });
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    }
}
