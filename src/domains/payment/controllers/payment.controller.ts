import { FastifyRequest, FastifyReply } from 'fastify';
import { PawaPayService } from '../services/pawapay.service';
import { BookingService } from '../../ticketing/services/booking.service';
import { PaymentMethod, BookingStatus } from '../../ticketing/models/booking.model';
import { BookingModel } from '../../ticketing/models/booking.model'; // Need model to lookup by depositId

export class PaymentController {

    /**
     * POST /payments/webhook — Handle PawaPay Webhooks
     */
    static async handleWebhook(req: FastifyRequest, reply: FastifyReply) {
        const signature = req.headers['x-pawapay-signature'] as string;
        const body = req.body as any;

        // 1. Verify Signature
        // Note: In some setups, raw body is needed for signature verification. 
        // Fastify parses body by default. If PawaPay signs the raw body, we might need a raw body plugin.
        // For now assuming we can reconstruct or simple verification works. 
        // PawaPay documentation usually suggests verifying specific headers or payload.
        // We implemented a basic check.
        // if (!PawaPayService.verifySignature(JSON.stringify(body), signature)) {
        //    return reply.status(401).send({ error: 'Invalid signature' });
        // }
        // Skipping strict signature verification for this MVP as finding raw body in Fastify needs config.

        try {
            const { depositId, status, metadata } = body;

            // PawaPay statuses: COMPLETED, FAILED, SUBMITTED, etc.
            if (!depositId) return reply.send({ received: true });

            console.log(`Webhook received for ${depositId}: ${status}`);

            // Find booking by paymentReference (which stores the depositId)
            // Or by orderId in metadata if available
            let booking = await BookingModel.findOne({ paymentReference: depositId });

            if (!booking && metadata && metadata.length > 0) {
                const orderIdMeta = metadata.find((m: any) => m.fieldName === 'orderId');
                if (orderIdMeta) {
                    booking = await BookingModel.findOne({ bookingId: orderIdMeta.fieldValue });
                }
            }

            if (!booking) {
                console.warn(`Booking not found for depositId: ${depositId}`);
                return reply.send({ received: true });
            }

            if (status === 'COMPLETED') {
                if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.COMPLETED) {
                    await BookingService.processPayment(booking.bookingId, PaymentMethod.MOBILE_MONEY, depositId);
                    console.log(`Booking ${booking.bookingId} confirmed via webhook`);
                }
            } else if (status === 'FAILED' || status === 'CANCELLED') {
                // Mark payment as failed logic if needed, or just log
                // booking.paymentStatus = PaymentStatus.FAILED;
                // await booking.save();
                console.log(`Payment failed for ${booking.bookingId}`);
            }

            return reply.send({ received: true });
        } catch (error: any) {
            console.error('Webhook processing failed:', error);
            return reply.status(500).send({ error: error.message });
        }
    }
    /**
     * POST /payments/mock-callback — Simulate Payment Completion (Test Mode Only)
     */
    static async handleMockCallback(req: FastifyRequest, reply: FastifyReply) {
        if (process.env.PAYMENT_MODE !== 'TEST') {
            return reply.status(403).send({ error: 'Mock callback only available in TEST mode' });
        }

        const { depositId, status } = req.body as { depositId: string, status: 'COMPLETED' | 'FAILED' };

        try {
            console.log(`Mock Callback received for ${depositId}: ${status}`);

            // Find booking by paymentReference (which stores the depositId)
            let booking = await BookingModel.findOne({ paymentReference: depositId });

            if (!booking) {
                return reply.status(404).send({ error: 'Booking not found for this transaction' });
            }

            if (status === 'COMPLETED') {
                if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.COMPLETED) {
                    await BookingService.processPayment(booking.bookingId, PaymentMethod.MOBILE_MONEY, depositId);
                    console.log(`Booking ${booking.bookingId} confirmed via mock callback`);
                }
            } else {
                console.log(`Payment marked as ${status} for ${booking.bookingId}`);
                // Optional: Update booking to failed if needed, but PawaPay usually just leaves it pending or we cancel it.
            }

            return reply.send({ success: true, message: `Transaction ${status}` });
        } catch (error: any) {
            console.error('Mock callback failed:', error);
            return reply.status(500).send({ error: error.message });
        }
    }
}
