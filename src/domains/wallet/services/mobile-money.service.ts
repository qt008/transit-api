import {
    MobileMoneyTransactionModel,
    MobileMoneyProvider,
    TransactionStatus,
    TransactionType
} from '../models/mobile-money-transaction.model';
import { WalletService } from './wallet.service';
import { randomUUID } from 'crypto';
import crypto from 'crypto';

/**
 * Mobile Money Integration Service
 * Handles MTN, Vodafone, AirtelTigo payments
 */
export class MobileMoneyService {
    private walletService: WalletService;

    constructor() {
        this.walletService = new WalletService();
    }

    /**
     * Initiate top-up request to mobile money provider
     */
    async initiateTopup(
        userId: string,
        walletAccountId: string,
        provider: MobileMoneyProvider,
        phoneNumber: string,
        amount: number
    ) {
        const transactionId = `MOMO-${randomUUID()}`;

        // Create pending transaction
        const transaction = await MobileMoneyTransactionModel.create({
            transactionId,
            userId,
            walletAccountId,
            type: TransactionType.TOPUP,
            provider,
            phoneNumber,
            amount,
            status: TransactionStatus.PENDING
        });

        // Call provider API (mock for now)
        const providerResponse = await this.callProviderAPI(provider, {
            amount,
            phoneNumber,
            reference: transactionId
        });

        // Update with provider reference
        transaction.providerReference = providerResponse.reference;
        transaction.providerTransactionId = providerResponse.transactionId;
        await transaction.save();

        return {
            transactionId,
            status: 'PENDING',
            message: 'Please approve the transaction on your phone',
            providerReference: providerResponse.reference
        };
    }

    /**
     * Handle webhook callback from provider
     */
    async handleWebhook(
        providerTransactionId: string,
        status: 'success' | 'failed',
        callbackData: any
    ) {
        const transaction = await MobileMoneyTransactionModel.findOne({
            providerTransactionId
        });

        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.callbackReceived) {
            // Idempotency: already processed
            return { message: 'Already processed' };
        }

        transaction.callbackReceived = true;
        transaction.callbackData = callbackData;
        transaction.status = status === 'success'
            ? TransactionStatus.SUCCESS
            : TransactionStatus.FAILED;

        await transaction.save();

        // If successful, credit wallet
        if (status === 'success') {
            await this.walletService.creditWallet(
                transaction.walletAccountId,
                transaction.amount,
                `Mobile Money Top-up - ${transaction.provider}`,
                {
                    transactionId: transaction.transactionId,
                    provider: transaction.provider
                }
            );
        }

        return { success: true, transaction };
    }

    /**
     * Initiate withdrawal to mobile money
     */
    async initiateWithdraw(
        userId: string,
        walletAccountId: string,
        provider: MobileMoneyProvider,
        phoneNumber: string,
        amount: number
    ) {
        const transactionId = `WITHDRAW-${randomUUID()}`;

        // Debit wallet first (ensure sufficient funds)
        await this.walletService.debitWallet(
            walletAccountId,
            amount,
            `Withdrawal to ${provider} - ${phoneNumber}`,
            { transactionId }
        );

        // Create transaction
        const transaction = await MobileMoneyTransactionModel.create({
            transactionId,
            userId,
            walletAccountId,
            type: TransactionType.WITHDRAW,
            provider,
            phoneNumber,
            amount,
            status: TransactionStatus.PENDING
        });

        // Call provider disbursement API
        const providerResponse = await this.callProviderAPI(provider, {
            amount,
            phoneNumber,
            reference: transactionId,
            type: 'disbursement'
        });

        transaction.providerReference = providerResponse.reference;
        transaction.providerTransactionId = providerResponse.transactionId;
        transaction.status = TransactionStatus.SUCCESS; // Assume instant for now
        await transaction.save();

        return {
            transactionId,
            status: 'SUCCESS',
            message: 'Withdrawal initiated successfully'
        };
    }

    /**
     * P2P Transfer between wallets
     */
    async transfer(
        senderUserId: string,
        senderWalletId: string,
        recipientWalletId: string,
        amount: number
    ) {
        const transactionId = `TRANSFER-${randomUUID()}`;

        // Execute double-entry transfer
        await this.walletService.createTransaction({
            debitAccountId: senderWalletId,
            creditAccountId: recipientWalletId,
            amount,
            description: `P2P Transfer`,
            metadata: { transactionId },
            idempotencyKey: transactionId
        });

        // Record transfer
        await MobileMoneyTransactionModel.create({
            transactionId,
            userId: senderUserId,
            walletAccountId: senderWalletId,
            type: TransactionType.TRANSFER,
            provider: MobileMoneyProvider.MTN, // Not applicable
            phoneNumber: 'N/A',
            amount,
            recipientWalletId,
            status: TransactionStatus.SUCCESS
        });

        return {
            transactionId,
            status: 'SUCCESS',
            message: 'Transfer completed successfully'
        };
    }

    /**
     * Mock provider API call
     */
    private async callProviderAPI(provider: MobileMoneyProvider, data: any) {
        // In production: Make HTTP request to MTN/Vodafone/AirtelTigo APIs
        // For now: simulate response

        return {
            reference: `${provider}-${randomUUID().slice(0, 8)}`,
            transactionId: `PROV-${randomUUID()}`,
            status: 'PENDING'
        };
    }

    /**
     * Verify webhook signature (security)
     */
    verifyWebhookSignature(signature: string, payload: string, secret: string): boolean {
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        return signature === expectedSignature;
    }
}
