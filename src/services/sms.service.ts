import axios from 'axios';
import { env } from '../config/env';

export class SMSService {
    private apiKey: string;
    private senderId: string;
    private baseUrl = 'https://sms.arkesel.com/api/v2/sms';

    constructor() {
        this.apiKey = env.ARKESEL_API_KEY;
        this.senderId = env.ARKESEL_SENDER_ID || 'TransitGH';
    }

    /**
     * Send OTP via SMS using Arkesel API
     */
    async sendOTP(phone: string, code: string): Promise<boolean> {
        try {
            const message = `Your TransitGhana verification code is: ${code}. Valid for 5 minutes. Do not share this code.`;

            const response = await axios.post(
                `${this.baseUrl}/send`,
                {
                    sender: this.senderId,
                    message,
                    recipients: [phone], // Format: +233XXXXXXXXX
                },
                {
                    headers: {
                        'api-key': this.apiKey,
                        'Content-Type': 'application/json',
                    },
                }
            );

            // Arkesel returns code '1000' for success
            return response.data.code === '1000';
        } catch (error: any) {
            console.error('SMS send failed:', error.response?.data || error.message);
            throw new Error('Failed to send OTP');
        }
    }

    /**
     * Send generic SMS notification
     */
    async sendSMS(phone: string, message: string): Promise<boolean> {
        try {
            const response = await axios.post(
                `${this.baseUrl}/send`,
                {
                    sender: this.senderId,
                    message,
                    recipients: [phone],
                },
                {
                    headers: {
                        'api-key': this.apiKey,
                        'Content-Type': 'application/json',
                    },
                }
            );

            return response.data.code === '1000';
        } catch (error: any) {
            console.error('SMS send failed:', error.response?.data || error.message);
            return false;
        }
    }
}
