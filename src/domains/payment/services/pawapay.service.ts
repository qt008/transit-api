import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface InitiateDepositInput {
    amount: string; // PawaPay uses string for amount usually to avoid float issues, or strict number
    currency: string;
    phoneNumber: string; // E.164 format
    country: string; // ISO 2-letter country code
    correspondent: string; // 'MTN_MOMO_GHA' etc.
    description: string;
    orderId: string;
}

interface PaymentResponse {
    depositId: string;
    status: string;
    redirectUrl?: string; // For some providers
}

export class PawaPayService {
    private static get baseUrl() {
        return process.env.PAWAPAY_API_URL || 'https://api.sandbox.pawapay.io';
    }

    private static get token() {
        return process.env.PAWAPAY_API_TOKEN || '';
    }

    /**
     * Initiate a Mobile Money Deposit (Payment Request)
     */
    static async initiateDeposit(input: InitiateDepositInput): Promise<PaymentResponse> {
        try {
            const response = await axios.post(
                `${this.baseUrl}/deposits`,
                {
                    depositId: uuidv4(), // Unique ID for PawaPay
                    amount: input.amount,
                    currency: input.currency,
                    country: input.country,
                    correspondent: input.correspondent,
                    payer: {
                        type: 'MSISDN',
                        address: {
                            value: input.phoneNumber
                        }
                    },
                    customerTimestamp: new Date().toISOString(),
                    statementDescription: input.description.substring(0, 20), // Max length limits apply often
                    metadata: [
                        { fieldName: 'orderId', fieldValue: input.orderId }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Handle successful initiation
            // PawaPay returns 'ACCEPTED' or 'CREATED' usually
            // We need to return the 'depositId' to track it.
            return {
                depositId: response.data.depositId,
                status: response.data.status,
                redirectUrl: response.data.redirectUrl
            };
        } catch (error: any) {
            console.error('PawaPay Deposit Error:', error.response?.data || error.message);
            // In Sandbox, if token is missing, we can simulate success for testing UI
            if (process.env.NODE_ENV !== 'production' && !this.token) {
                console.warn('⚠️ Mocking PawaPay Success (No Token Provided)');
                return {
                    depositId: `MOCK-${uuidv4()}`,
                    status: 'PENDING',
                };
            }
            throw new Error(error.response?.data?.message || 'Payment initiation failed');
        }
    }

    /**
     * Check Payment Status (Polling fallback if webhooks fail)
     */
    static async checkStatus(depositId: string): Promise<string> {
        if (depositId.startsWith('MOCK-')) return 'COMPLETED'; // Mock success

        try {
            const response = await axios.get(
                `${this.baseUrl}/deposits/${depositId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                }
            );
            return response.data.status; // 'COMPLETED', 'FAILED', 'PENDING'
        } catch (error: any) {
            console.error('PawaPay Check Status Error:', error.response?.data || error.message);
            throw error;
        }
    }
}
