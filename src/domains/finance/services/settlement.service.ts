import { randomUUID } from 'crypto';
import { BookingModel, BookingStatus, PaymentStatus, BookingChannel } from '../../ticketing/models/booking.model';
import { SettlementModel, SettlementStatus, SettlementMethod, ISettlementLineItem } from '../models/settlement.model';
import { WalletService } from '../../wallet/services/wallet.service';
import { AccountModel } from '../../wallet/models/account.model';
import { PawaPayService } from '../../payment/services/pawapay.service';

// Default fee rates — these should be stored in operator/tenant config in production
const DEFAULT_PLATFORM_FEE_RATE = 0.02;    // 2%
const DEFAULT_AGENT_COMMISSION_RATE = 0.01; // 1% for POS sales

const walletService = new WalletService();

export class SettlementService {

    /**
     * Calculate and create a settlement for an operator for a given period.
     * Does NOT transfer funds yet — status will be PENDING until approved.
     */
    async calculateSettlement(input: {
        operatorId: string;
        tenantId: string;
        periodStart: Date;
        periodEnd: Date;
        platformFeeRate?: number;
        agentCommissionRate?: number;
    }) {
        const {
            operatorId,
            tenantId,
            periodStart,
            periodEnd,
            platformFeeRate = DEFAULT_PLATFORM_FEE_RATE,
            agentCommissionRate = DEFAULT_AGENT_COMMISSION_RATE
        } = input;

        // Check no overlapping pending/approved settlement exists for this period
        const conflict = await SettlementModel.findOne({
            operatorId,
            tenantId,
            status: { $in: [SettlementStatus.PENDING, SettlementStatus.APPROVED, SettlementStatus.PROCESSING] },
            periodStart: { $lt: periodEnd },
            periodEnd: { $gt: periodStart }
        });
        if (conflict) {
            throw new Error(`A settlement already exists for this period (${conflict.settlementId})`);
        }

        // Find all paid, completed bookings in period that haven't been settled
        const bookings = await BookingModel.find({
            tenantId,
            paymentStatus: PaymentStatus.PAID,
            status: { $in: [BookingStatus.COMPLETED, BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED] },
            paidAt: { $gte: periodStart, $lte: periodEnd },
            // Only include bookings for this operator via tripId lookup — for simplicity we use routeId
            // In production, join with Trip to get operatorId
        }).lean();

        if (bookings.length === 0) {
            throw new Error('No settled bookings found for this period');
        }

        let totalFareCollected = 0;
        let totalPlatformFees = 0;
        let totalAgentCommissions = 0;
        const lineItems: ISettlementLineItem[] = [];

        for (const booking of bookings) {
            const fare = booking.totalAmount; // In pesewas
            const platformFee = Math.floor(fare * platformFeeRate);
            const isAgentSale = booking.bookingChannel === BookingChannel.POS;
            const agentCommission = isAgentSale ? Math.floor(fare * agentCommissionRate) : 0;
            const netAmount = fare - platformFee - agentCommission;

            totalFareCollected += fare;
            totalPlatformFees += platformFee;
            totalAgentCommissions += agentCommission;

            lineItems.push({
                bookingId: booking.bookingId,
                tripId: booking.tripId,
                fareAmount: fare,
                platformFee,
                agentCommission,
                netAmount,
                channel: booking.bookingChannel,
                settledAt: new Date()
            });
        }

        const totalNetPayable = totalFareCollected - totalPlatformFees - totalAgentCommissions;

        const settlement = await SettlementModel.create({
            settlementId: `STL-${randomUUID()}`,
            operatorId,
            tenantId,
            periodStart,
            periodEnd,
            totalFareCollected,
            totalPlatformFees,
            totalAgentCommissions,
            totalNetPayable,
            platformFeeRate,
            agentCommissionRate,
            lineItems,
            bookingCount: bookings.length,
            status: SettlementStatus.PENDING
        });

        return settlement;
    }

    /**
     * Approve a settlement — stakeholder marks it ready for payout.
     */
    async approveSettlement(settlementId: string, approvedBy: string) {
        const settlement = await SettlementModel.findOne({ settlementId });
        if (!settlement) throw new Error('Settlement not found');
        if (settlement.status !== SettlementStatus.PENDING) {
            throw new Error(`Cannot approve settlement in ${settlement.status} status`);
        }

        settlement.status = SettlementStatus.APPROVED;
        settlement.approvedBy = approvedBy;
        settlement.approvedAt = new Date();
        await settlement.save();

        return settlement;
    }

    /**
     * Execute payout for an approved settlement.
     * Moves funds from operator escrow → operator wallet (or MoMo).
     */
    async executeSettlement(settlementId: string, method: SettlementMethod, payoutDetails?: {
        momoNumber?: string;
        momoProvider?: string;
    }) {
        const settlement = await SettlementModel.findOne({ settlementId });
        if (!settlement) throw new Error('Settlement not found');
        if (settlement.status !== SettlementStatus.APPROVED) {
            throw new Error(`Settlement must be APPROVED before payout. Current: ${settlement.status}`);
        }

        settlement.status = SettlementStatus.PROCESSING;
        settlement.payoutMethod = method;
        settlement.payoutInitiatedAt = new Date();
        if (payoutDetails?.momoNumber) settlement.operatorMomoNumber = payoutDetails.momoNumber;
        await settlement.save();

        try {
            // Resolve accounts
            const escrowAccount = await AccountModel.findOne({
                ownerId: settlement.operatorId,
                type: '2100'
            });
            if (!escrowAccount) throw new Error('Operator escrow account not found');

            if (method === SettlementMethod.WALLET_CREDIT) {
                // Transfer from escrow → operator revenue wallet
                const operatorWallet = await AccountModel.findOne({
                    ownerId: settlement.operatorId,
                    type: '4100' // REVENUE_FARE
                });
                if (!operatorWallet) throw new Error('Operator revenue account not found');

                const txnId = await walletService.createTransaction({
                    debitAccountId: escrowAccount.accountId,
                    creditAccountId: operatorWallet.accountId,
                    amount: settlement.totalNetPayable,
                    description: `Settlement ${settlementId} payout`,
                    metadata: {
                        settlementId,
                        operatorId: settlement.operatorId,
                        bookingCount: settlement.bookingCount
                    }
                });

                // Platform fee → platform revenue account
                const platformAccount = await AccountModel.findOne({ ownerId: 'PLATFORM', type: '4100' });
                if (platformAccount && settlement.totalPlatformFees > 0) {
                    await walletService.createTransaction({
                        debitAccountId: escrowAccount.accountId,
                        creditAccountId: platformAccount.accountId,
                        amount: settlement.totalPlatformFees,
                        description: `Platform fees for ${settlementId}`,
                        metadata: { settlementId, type: 'PLATFORM_FEE' }
                    });
                }

                settlement.walletTransactionId = txnId;
                settlement.status = SettlementStatus.COMPLETED;
                settlement.payoutCompletedAt = new Date();

            } else if (method === SettlementMethod.MOMO) {
                if (!payoutDetails?.momoNumber || !payoutDetails?.momoProvider) {
                    throw new Error('MoMo number and provider required for mobile money payout');
                }

                const amountGHS = (settlement.totalNetPayable / 100).toFixed(2);
                const payoutResult = await PawaPayService.initiateDeposit({
                    amount: amountGHS,
                    currency: 'GHS',
                    phoneNumber: payoutDetails.momoNumber,
                    country: 'GH',
                    correspondent: payoutDetails.momoProvider,
                    description: `Settlement ${settlementId}`,
                    orderId: settlementId
                });

                settlement.payoutReference = payoutResult.depositId;
                // Keep PROCESSING — webhook will set COMPLETED when MoMo confirms
            }

            await settlement.save();
            return settlement;

        } catch (err: any) {
            settlement.status = SettlementStatus.FAILED;
            settlement.payoutFailureReason = err.message;
            await settlement.save();
            throw err;
        }
    }

    /**
     * Collection summary across all channels — for stakeholder dashboard.
     */
    async getCollectionSummary(input: {
        tenantId: string;
        startDate: Date;
        endDate: Date;
        operatorId?: string;
    }) {
        const { tenantId, startDate, endDate, operatorId } = input;

        const matchFilter: any = {
            tenantId,
            paymentStatus: PaymentStatus.PAID,
            paidAt: { $gte: startDate, $lte: endDate }
        };
        if (operatorId) matchFilter.operatorId = operatorId;

        const [byChannel, byMethod, byDay, totals] = await Promise.all([
            // Revenue by booking channel
            BookingModel.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: '$bookingChannel',
                        count: { $sum: 1 },
                        revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }
                    }
                },
                { $sort: { revenue: -1 } }
            ]),

            // Revenue by payment method
            BookingModel.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: '$paymentMethod',
                        count: { $sum: 1 },
                        revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }
                    }
                },
                { $sort: { revenue: -1 } }
            ]),

            // Daily trend
            BookingModel.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
                        count: { $sum: 1 },
                        revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }
                    }
                },
                { $sort: { _id: 1 } }
            ]),

            // Overall totals
            BookingModel.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: null,
                        totalBookings: { $sum: 1 },
                        grossRevenue: { $sum: { $multiply: ['$totalAmount', 0.01] } },
                        platformFees: { $sum: { $multiply: ['$totalAmount', DEFAULT_PLATFORM_FEE_RATE, 0.01] } }
                    }
                }
            ])
        ]);

        const summary = totals[0] || { totalBookings: 0, grossRevenue: 0, platformFees: 0 };

        return {
            period: { start: startDate, end: endDate },
            summary: {
                totalBookings: summary.totalBookings,
                grossRevenue: summary.grossRevenue,
                platformFees: summary.platformFees,
                netToOperators: summary.grossRevenue - summary.platformFees
            },
            byChannel: byChannel.map(c => ({ channel: c._id, count: c.count, revenue: c.revenue })),
            byMethod: byMethod.map(m => ({ method: m._id, count: m.count, revenue: m.revenue })),
            dailyTrend: byDay.map(d => ({ date: d._id, count: d.count, revenue: d.revenue }))
        };
    }

    /**
     * Revenue per bus trip — for the stakeholder bus-level view.
     */
    async getBusRevenue(input: {
        tenantId: string;
        startDate: Date;
        endDate: Date;
        operatorId?: string;
    }) {
        const { tenantId, startDate, endDate, operatorId } = input;

        const matchFilter: any = {
            tenantId,
            paymentStatus: PaymentStatus.PAID,
            scheduledDepartureDate: { $gte: startDate, $lte: endDate }
        };

        return BookingModel.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: '$tripId',
                    bookingCount: { $sum: 1 },
                    grossRevenue: { $sum: { $multiply: ['$totalAmount', 0.01] } },
                    route: { $first: '$routeName' },
                    channels: { $addToSet: '$bookingChannel' },
                    departureDate: { $first: '$scheduledDepartureDate' }
                }
            },
            { $sort: { departureDate: -1 } },
            {
                $project: {
                    tripId: '$_id',
                    bookingCount: 1,
                    grossRevenue: 1,
                    route: 1,
                    channels: 1,
                    departureDate: 1,
                    _id: 0
                }
            }
        ]);
    }
}
