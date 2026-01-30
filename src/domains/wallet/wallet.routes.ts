import { FastifyInstance } from 'fastify';
import { WalletController } from './controllers/wallet.controller';

export async function walletRoutes(fastify: FastifyInstance) {

    fastify.addHook('onRequest', fastify.authenticate);

    // Wallet balance and transactions
    fastify.get('/me/balance', WalletController.getMyBalance);
    fastify.get('/me/transactions', WalletController.getMyTransactions);

    // Mobile money operations
    fastify.post('/topup', WalletController.topup);
    fastify.post('/topup/callback', { preHandler: [] }, WalletController.topupCallback); // No auth
    fastify.post('/withdraw', WalletController.withdraw);
    fastify.post('/transfer', WalletController.transfer);
}
