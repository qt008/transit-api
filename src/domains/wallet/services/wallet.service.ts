import mongoose, { ClientSession } from 'mongoose';
import { AccountModel } from '../models/account.model';
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
     * Executes a Double-Entry Transaction with ACID guarantees.
     * Total Assets = Total Liabilities + Equity
     */
    async createTransaction(request: TransactionRequest): Promise<string> {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { debitAccountId, creditAccountId, amount, description, metadata, idempotencyKey } = request;

            // 1. Idempotency Check
            if (idempotencyKey) {
                const existingFailed = await LedgerEntryModel.findOne({ idempotencyKey }).session(session);
                if (existingFailed) {
                    throw new Error(`Duplicate Transaction: ${idempotencyKey}`);
                }
            }

            const transactionId = randomUUID();

            // 2. Fetch Accounts (Locking simplified for now)
            const debitAccount = await AccountModel.findOne({ accountId: debitAccountId }).session(session);
            const creditAccount = await AccountModel.findOne({ accountId: creditAccountId }).session(session);

            if (!debitAccount || !creditAccount) {
                throw new Error('Invalid accounts involved in transaction');
            }

            // 3. Check Sufficient Funds (if needed)
            // Liability accounts (like Escrow) can go negative depending on logic, but User Wallets (Assets) typically shouldn't.
            if (debitAccount.balance < amount) {
                // Allow overdraft ONLY if it's a specific system account type if needed
                throw new Error(`Insufficient funds in account ${debitAccountId}`);
            }

            // 4. Update Balances
            debitAccount.balance -= amount;
            creditAccount.balance += amount;

            await debitAccount.save({ session });
            await creditAccount.save({ session });

            // 5. Create Ledger Entries (Immutable)
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
            }], { session });

            await session.commitTransaction();
            return transactionId;

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
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
     */
    async creditWallet(
        accountId: string,
        amount: number,
        description: string,
        metadata: Record<string, any> = {}
    ): Promise<void> {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const account = await AccountModel.findOne({ accountId }).session(session);
            if (!account) throw new Error('Account not found');

            account.balance += amount;
            await account.save({ session });

            await LedgerEntryModel.create([{
                transactionId: randomUUID(),
                accountId,
                amount,
                type: TransactionType.CREDIT,
                balanceAfter: account.balance,
                description,
                metadata
            }], { session });

            await session.commitTransaction();
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
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
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const account = await AccountModel.findOne({ accountId }).session(session);
            if (!account) throw new Error('Account not found');
            if (account.balance < amount) throw new Error('Insufficient funds');

            account.balance -= amount;
            await account.save({ session });

            await LedgerEntryModel.create([{
                transactionId: randomUUID(),
                accountId,
                amount,
                type: TransactionType.DEBIT,
                balanceAfter: account.balance,
                description,
                metadata
            }], { session });

            await session.commitTransaction();
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }
}
