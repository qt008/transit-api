import QRCode from 'qrcode';
import crypto from 'crypto';

export class QRCodeService {

    /**
     * Generate QR code for ticket
     */
    static async generateTicketQR(ticketData: {
        ticketId: string;
        userId: string;
        routeId: string;
        price: number;
        expiresAt: Date;
    }): Promise<{ qrCode: string; signature: string; secret: string }> {
        const secret = crypto.randomBytes(16).toString('hex');

        // Create signature to prevent tampering
        const dataToSign = `${ticketData.ticketId}:${ticketData.userId}:${ticketData.routeId}:${ticketData.price}:${ticketData.expiresAt.toISOString()}`;
        const signature = crypto
            .createHmac('sha256', process.env.TICKET_SECRET || 'ticket-secret')
            .update(dataToSign)
            .digest('hex');

        // QR payload
        const qrPayload = JSON.stringify({
            ticketId: ticketData.ticketId,
            signature,
            expiresAt: ticketData.expiresAt.toISOString()
        });

        // Generate QR code as base64
        const qrCode = await QRCode.toDataURL(qrPayload, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            width: 300
        });

        return { qrCode, signature, secret };
    }

    /**
     * Verify QR code signature
     */
    static verifyTicketSignature(
        ticketId: string,
        userId: string,
        routeId: string,
        price: number,
        expiresAt: Date,
        signature: string
    ): boolean {
        const dataToSign = `${ticketId}:${userId}:${routeId}:${price}:${expiresAt.toISOString()}`;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.TICKET_SECRET || 'ticket-secret')
            .update(dataToSign)
            .digest('hex');

        return signature === expectedSignature;
    }

    /**
     * Check if ticket is expired
     */
    static isExpired(expiresAt: Date): boolean {
        return new Date() > new Date(expiresAt);
    }
}
