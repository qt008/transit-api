import { FastifyInstance } from 'fastify';
import { WalletController, TopupSchema, WithdrawSchema, TransferSchema, WebhookSchema, SimulateCallbackSchema } from './controllers/wallet.controller';
import { validateBody } from '../../shared/kernel/validate.middleware';

export async function walletRoutes(fastify: FastifyInstance) {

    fastify.addHook('onRequest', fastify.authenticate);

    // Wallet balance and transactions
    fastify.get('/me/balance', WalletController.getMyBalance);
    fastify.get('/me/transactions', WalletController.getMyTransactions);
    fastify.get('/me/qr', WalletController.getMyWalletQR);

    // Mobile money operations
    fastify.post('/topup', {
        preHandler: [validateBody(TopupSchema)]
    }, WalletController.topup);
    fastify.post('/topup/callback', {
        preHandler: [validateBody(WebhookSchema)]
    }, WalletController.topupCallback);
    fastify.post('/topup/simulate-callback', {
        preHandler: [validateBody(SimulateCallbackSchema)]
    }, WalletController.simulateTopupCallback);
    fastify.post('/withdraw', {
        preHandler: [validateBody(WithdrawSchema)]
    }, WalletController.withdraw);
    fastify.post('/transfer', {
        preHandler: [validateBody(TransferSchema)]
    }, WalletController.transfer);
}
