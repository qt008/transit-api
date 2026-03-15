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
        if (settlement.status !== SettlementStatus.APPROVED && settlement.status !== SettlementStatus.FAILED) {
            throw new Error(`Settlement must be APPROVED (or FAILED for retry) before payout. Current: ${settlement.status}`);
        }

        settlement.status = SettlementStatus.PROCESSING;
        settlement.payoutMethod = method;
        settlement.payoutInitiatedAt = new Date();
        if (payoutDetails?.momoNumber) settlement.operatorMomoNumber = payoutDetails.momoNumber;
        await settlement.save();

        try {
            // Resolve (or lazily create) accounts
            const ensureAccount = async (ownerId: string, type: string): Promise<any> => {
                let account = await AccountModel.findOne({ ownerId, type });
                if (!account) {
                    account = await AccountModel.create({
                        accountId: `ACCT-${randomUUID()}`,
                        ownerId,
                        type,
                        balance: 0,
                        currency: 'GHS',
                        isActive: true
                    });
                }
                return account;
            };

            const escrowAccount = await AccountModel.findOne({
                ownerId: settlement.operatorId,
                type: '2100'
            });
            if (!escrowAccount) throw new Error(`Operator escrow account (2100) not found for operator ${settlement.operatorId}. Ensure funds were collected into the escrow account before settling.`);

            if (method === SettlementMethod.WALLET_CREDIT) {
                // Transfer from escrow → operator revenue wallet (auto-create if missing)
                const operatorWallet = await ensureAccount(settlement.operatorId, '4100');

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

                // Platform fee → platform revenue account (auto-create if missing)
                if (settlement.totalPlatformFees > 0) {
                    const platformAccount = await ensureAccount('PLATFORM', '4100');
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
     * tenantId is optional: undefined = platform-wide (all operators).
     */
    async getCollectionSummary(input: {
        tenantId?: string;
        startDate: Date;
        endDate: Date;
        operatorId?: string;
    }) {
        const { tenantId, startDate, endDate, operatorId } = input;

        const matchFilter: any = {
            paymentStatus: PaymentStatus.PAID,
            paidAt: { $gte: startDate, $lte: endDate }
        };
        if (tenantId) matchFilter.tenantId = tenantId;
        if (operatorId) matchFilter.operatorId = operatorId;

        const [byChannel, byMethod, byDay, totals] = await Promise.all([
            BookingModel.aggregate([
                { $match: matchFilter },
                { $group: { _id: '$bookingChannel', count: { $sum: 1 }, revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } } } },
                { $sort: { revenue: -1 } }
            ]),
            BookingModel.aggregate([
                { $match: matchFilter },
                { $group: { _id: '$paymentMethod', count: { $sum: 1 }, revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } } } },
                { $sort: { revenue: -1 } }
            ]),
            BookingModel.aggregate([
                { $match: matchFilter },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } }, count: { $sum: 1 }, revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } } } },
                { $sort: { _id: 1 } }
            ]),
            BookingModel.aggregate([
                { $match: matchFilter },
                { $group: { _id: null, totalBookings: { $sum: 1 }, grossRevenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }, platformFees: { $sum: { $multiply: ['$totalAmount', DEFAULT_PLATFORM_FEE_RATE, 0.01] } } } }
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
            byChannel: byChannel.map((c: any) => ({ channel: c._id, count: c.count, revenue: c.revenue })),
            byMethod: byMethod.map((m: any) => ({ method: m._id, count: m.count, revenue: m.revenue })),
            dailyTrend: byDay.map((d: any) => ({ date: d._id, count: d.count, revenue: d.revenue }))
        };
    }

    /**
     * Revenue per bus trip.
     * tenantId is optional: undefined = platform-wide.
     */
    async getBusRevenue(input: {
        tenantId?: string;
        startDate: Date;
        endDate: Date;
        operatorId?: string;
    }) {
        const { tenantId, startDate, endDate } = input;

        const matchFilter: any = {
            paymentStatus: PaymentStatus.PAID,
            scheduledDepartureDate: { $gte: startDate, $lte: endDate }
        };
        if (tenantId) matchFilter.tenantId = tenantId;

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

    /**
     * Profit and Loss — monthly GTV and platform margin.
     * tenantId is optional: undefined = platform-wide.
     */
    async getProfitAndLoss(input: { tenantId?: string; startDate: Date; endDate: Date }) {
        const { tenantId, startDate, endDate } = input;

        const matchFilter: any = {
            paymentStatus: PaymentStatus.PAID,
            paidAt: { $gte: startDate, $lte: endDate }
        };
        if (tenantId) matchFilter.tenantId = tenantId;

        const data = await BookingModel.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
                    revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } },
                    margin: { $sum: { $multiply: ['$totalAmount', DEFAULT_PLATFORM_FEE_RATE, 0.01] } }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { name: '$_id', revenue: 1, margin: 1, _id: 0 } }
        ]);

        return data;
    }

    /**
     * Growth Metrics — compares current period vs the equivalent prior period.
     * tenantId is optional: undefined = platform-wide.
     * @param periodDays - length of each comparison window (default 30)
     */
    async getGrowthMetrics(tenantId: string | undefined, periodDays: number = 30) {
        const now = new Date();
        const periodMs = periodDays * 24 * 60 * 60 * 1000;
        const currentStart = new Date(now.getTime() - periodMs);
        const previousStart = new Date(now.getTime() - 2 * periodMs);

        const baseFilter: any = { paymentStatus: PaymentStatus.PAID };
        if (tenantId) baseFilter.tenantId = tenantId;

        const [current, previous] = await Promise.all([
            BookingModel.aggregate([
                { $match: { ...baseFilter, paidAt: { $gte: currentStart, $lte: now } } },
                { $group: { _id: null, revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }, count: { $sum: 1 } } }
            ]),
            BookingModel.aggregate([
                { $match: { ...baseFilter, paidAt: { $gte: previousStart, $lt: currentStart } } },
                { $group: { _id: null, revenue: { $sum: { $multiply: ['$totalAmount', 0.01] } }, count: { $sum: 1 } } }
            ])
        ]);

        const currentRev = current[0]?.revenue || 0;
        const lastRev = previous[0]?.revenue || 0;
        const currentVol = current[0]?.count || 0;
        const lastVol = previous[0]?.count || 0;

        const revGrowth = lastRev > 0 ? ((currentRev - lastRev) / lastRev) * 100 : 0;
        const volGrowth = lastVol > 0 ? ((currentVol - lastVol) / lastVol) * 100 : 0;

        return {
            revenue: { current: currentRev, previous: lastRev, growth: revGrowth.toFixed(2) },
            volume: { current: currentVol, previous: lastVol, growth: volGrowth.toFixed(2) }
        };
    }
}
