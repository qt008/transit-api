import mongoose, { ClientSession } from 'mongoose';
import { AccountModel, AccountType } from '../models/account.model';
import { LedgerEntryModel, TransactionType } from '../models/ledger-entry.model';
import { randomUUID } from 'crypto';

interface TransactionRequest {
    debitAccountId: string;
    creditAccountId: string;
    amount: number; // In Pesewas
    description: string;
    metadata: Record<string, any>;
    idempotencyKey?: string;
}

export class WalletService {

    /**
     * Executes a Double-Entry Transaction (without transactions for non-replica set)
     * Total Assets = Total Liabilities + Equity
     */
    async createTransaction(request: TransactionRequest): Promise<string> {
        try {
            const { debitAccountId, creditAccountId, amount, description, metadata, idempotencyKey } = request;

            // 1. Idempotency Check
            if (idempotencyKey) {
                const existingFailed = await LedgerEntryModel.findOne({ idempotencyKey });
                if (existingFailed) {
                    throw new Error(`Duplicate Transaction: ${idempotencyKey}`);
                }
            }

            const transactionId = randomUUID();

            // 2. Fetch Accounts
            const debitAccount = await AccountModel.findOne({ accountId: debitAccountId });
            const creditAccount = await AccountModel.findOne({ accountId: creditAccountId });

            if (!debitAccount || !creditAccount) {
                throw new Error('Invalid accounts involved in transaction');
            }

            // 3. Check Sufficient Funds
            if (debitAccount.balance < amount) {
                throw new Error(`Insufficient funds in account ${debitAccountId}`);
            }

            // 4. Update Balances
            debitAccount.balance -= amount;
            creditAccount.balance += amount;

            await debitAccount.save();
            await creditAccount.save();

            // 5. Create Ledger Entries
            await LedgerEntryModel.create([{
                transactionId,
                accountId: debitAccountId,
                amount,
                type: TransactionType.DEBIT,
                balanceAfter: debitAccount.balance,
                description,
                metadata,
                idempotencyKey: idempotencyKey ? `${idempotencyKey}-dr` : undefined
            }, {
                transactionId,
                accountId: creditAccountId,
                amount,
                type: TransactionType.CREDIT,
                balanceAfter: creditAccount.balance,
                description,
                metadata,
                idempotencyKey: idempotencyKey ? `${idempotencyKey}-cr` : undefined
            }]);

            return transactionId;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Creates a new Account (Wallet) for a user or operator.
     */
    async createAccount(ownerId: string, type: any): Promise<string> {
        const accountId = `ACCT-${randomUUID()}`;
        await AccountModel.create({
            accountId,
            ownerId,
            type,
            balance: 0,
            currency: 'GHS'
        });
        return accountId;
    }

    /**
     * Credit a wallet (add funds)
     * Automatically creates the account if it doesn't exist (lazy creation)
     */
    async creditWallet(
        accountId: string,
        amount: number,
        description: string,
        metadata: Record<string, any> = {}
    ): Promise<void> {
        try {
            let account = await AccountModel.findOne({ accountId });
            
            // Lazy account creation if it doesn't exist
            if (!account) {
                console.log(`[WalletService] Creating wallet account ${accountId} on demand`);
                const newAccounts = await AccountModel.create([{
                    accountId,
                    ownerId: accountId.replace('ACCT-', '').replace('wallet-', ''),
                    type: AccountType.ASSET_PASSENGER_WALLET,
                    balance: 0,
                    currency: 'GHS',
                    isActive: true
                }]);
                account = newAccounts[0];
            }

            if (!account) {
                throw new Error('Failed to create wallet account');
            }

            account.balance += amount;
            await account.save();

            await LedgerEntryModel.create({
                transactionId: randomUUID(),
                accountId,
                amount,
                type: TransactionType.CREDIT,
                balanceAfter: account.balance,
                description,
                metadata
            });
        } catch (error) {
            throw error;
        }
    }

    /**
     * Debit a wallet (deduct funds)
     */
    async debitWallet(
        accountId: string,
        amount: number,
        description: string,
        metadata: Record<string, any> = {}
    ): Promise<void> {
        try {
            const account = await AccountModel.findOne({ accountId });
            if (!account) throw new Error('Account not found');
            if (account.balance < amount) throw new Error('Insufficient funds');

            account.balance -= amount;
            await account.save();

            await LedgerEntryModel.create({
                transactionId: randomUUID(),
                accountId,
                amount,
                type: TransactionType.DEBIT,
                balanceAfter: account.balance,
                description,
                metadata
            });
        } catch (error) {
            throw error;
        }
    }
}
