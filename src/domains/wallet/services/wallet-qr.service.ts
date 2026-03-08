import crypto from 'crypto';
import { AccountModel } from '../models/account.model';

/**
 * Secret used to HMAC-sign wallet QR payloads.
 * In production this MUST be set via the WALLET_QR_SECRET environment variable.
 */
const WALLET_QR_SECRET = process.env.WALLET_QR_SECRET || 'wallet-qr-dev-secret';

/**
 * QR payloads are valid for 24 hours. The client should refresh periodically.
 */
const QR_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Shape of the JSON string that is encoded in the QR image.
 */
export interface WalletQRPayload {
    type: 'WALLET';
    wId: string;   // walletAccountId
    uId: string;   // userId
    exp: number;   // Unix timestamp (seconds)
    sig: string;   // HMAC-SHA256 hex signature
}

export class WalletQRService {

    /**
     * Generate a signed wallet QR payload for the given user.
     * Returns the raw JSON string that the client renders as a QR code.
     */
    static generatePayload(userId: string, walletAccountId: string): string {
        const exp = Math.floor((Date.now() + QR_EXPIRY_MS) / 1000);

        const dataToSign = `WALLET:${walletAccountId}:${userId}:${exp}`;
        const sig = crypto
            .createHmac('sha256', WALLET_QR_SECRET)
            .update(dataToSign)
            .digest('hex');

        const payload: WalletQRPayload = {
            type: 'WALLET',
            wId: walletAccountId,
            uId: userId,
            exp,
            sig,
        };

        return JSON.stringify(payload);
    }

    /**
     * Verify a wallet QR payload scanned by a conductor.
     *
     * Checks:
     *  1. Payload is valid JSON with the correct shape
     *  2. HMAC signature matches (tamper-proof)
     *  3. Payload has not expired
     *  4. Wallet account exists and is active
     *
     * Returns the verified userId and walletAccountId on success.
     * Throws on any validation failure.
     */
    static async verifyPayload(
        rawPayload: string
    ): Promise<{ userId: string; walletAccountId: string }> {
        // 1. Parse
        let payload: WalletQRPayload;
        try {
            payload = JSON.parse(rawPayload);
        } catch {
            throw new Error('Invalid QR payload: not valid JSON');
        }

        if (payload.type !== 'WALLET' || !payload.wId || !payload.uId || !payload.exp || !payload.sig) {
            throw new Error('Invalid QR payload: missing required fields');
        }

        // 2. Verify signature
        const dataToSign = `WALLET:${payload.wId}:${payload.uId}:${payload.exp}`;
        const expectedSig = crypto
            .createHmac('sha256', WALLET_QR_SECRET)
            .update(dataToSign)
            .digest('hex');

        if (!crypto.timingSafeEqual(Buffer.from(payload.sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
            throw new Error('Invalid QR payload: signature mismatch');
        }

        // 3. Check expiry
        const nowSec = Math.floor(Date.now() / 1000);
        if (payload.exp < nowSec) {
            throw new Error('QR payload has expired — please refresh your QR code');
        }

        // 4. Verify wallet exists and is active
        const account = await AccountModel.findOne({
            accountId: payload.wId,
            isActive: true,
        });
        if (!account) {
            throw new Error('Wallet account not found or inactive');
        }

        return {
            userId: payload.uId,
            walletAccountId: payload.wId,
        };
    }
}
