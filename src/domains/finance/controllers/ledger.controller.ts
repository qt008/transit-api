import { FastifyReply, FastifyRequest } from 'fastify';
import { LedgerEntryModel } from '../../wallet/models/ledger-entry.model';
import { AccountModel, AccountType } from '../../wallet/models/account.model';

const PLATFORM_ROLES = new Set(['SUPER_ADMIN', 'GOVERNMENT']);

function getScopedTenantId(req: FastifyRequest): string | undefined {
    // @ts-ignore
    const { tenantId, role } = req.user || {};
    return PLATFORM_ROLES.has(role) ? undefined : tenantId;
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
    [AccountType.ASSET_PASSENGER_WALLET]: 'Passenger Wallet (Asset)',
    [AccountType.ASSET_MOMO_CLEARING]: 'MoMo Clearing (Asset)',
    [AccountType.LIABILITY_OPERATOR_ESCROW]: 'Operator Escrow (Liability)',
    [AccountType.REVENUE_FARE]: 'Fare Revenue (Income)',
    [AccountType.EXPENSE_COMMISSION]: 'Commission Expense',
};

function toAccountLabel(type: string | undefined): string {
    if (!type) return 'Unknown';
    return ACCOUNT_TYPE_LABELS[type] || type;
}

function categoryForAccount(type: string | undefined): 'assets' | 'liabilities' | 'income' | 'expenses' | 'other' {
    if (!type) return 'other';
    if (type.startsWith('1')) return 'assets';
    if (type.startsWith('2')) return 'liabilities';
    if (type.startsWith('4')) return 'income';
    if (type.startsWith('5')) return 'expenses';
    return 'other';
}

export class LedgerController {

    /**
     * GET /finance/ledger/entries?startDate=&endDate=&accountId=&type=&operatorId=&page=&limit=&q=
     */
    static async listEntries(req: FastifyRequest, reply: FastifyReply) {
        const { startDate, endDate, accountId, type, operatorId, page = '1', limit = '50', q } = req.query as any;
        const tenantId = getScopedTenantId(req);

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        if (endDate) end.setUTCHours(23, 59, 59, 999);

        const andFilters: any[] = [
            { createdAt: { $gte: start, $lte: end } }
        ];

        if (accountId) andFilters.push({ accountId });
        if (type) andFilters.push({ type });

        const scopedOperatorId = tenantId || operatorId;
        if (scopedOperatorId) {
            const accountIds = await AccountModel.find({ ownerId: scopedOperatorId }, { accountId: 1 }).lean();
            const ownerAccountIds = accountIds.map((a: any) => a.accountId).filter(Boolean);

            if (accountId) {
                const isOwned = ownerAccountIds.includes(accountId);
                if (!isOwned) {
                    return reply.send({
                        success: true,
                        data: [],
                        meta: { total: 0, page: parseInt(page), limit: parseInt(limit) },
                        period: { start, end }
                    });
                }
            } else if (ownerAccountIds.length > 0) {
                andFilters.push({
                    $or: [
                        { accountId: { $in: ownerAccountIds } },
                        { 'metadata.operatorId': scopedOperatorId }
                    ]
                });
            } else {
                andFilters.push({ 'metadata.operatorId': scopedOperatorId });
            }
        }

        const pageNum = Math.max(parseInt(page), 1);
        const limitNum = Math.min(Math.max(parseInt(limit), 1), 500);
        const skip = (pageNum - 1) * limitNum;

        if (q && String(q).trim().length > 0) {
            const query = String(q).trim();
            const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&'), 'i');
            andFilters.push({
                $or: [
                    { description: regex },
                    { transactionId: regex },
                    { accountId: regex },
                    { 'metadata.bookingId': regex },
                    { 'metadata.tripId': regex },
                    { 'metadata.routeId': regex },
                    { 'metadata.operatorId': regex }
                ]
            });
        }

        const match = andFilters.length === 1 ? andFilters[0] : { $and: andFilters };

        const total = await LedgerEntryModel.countDocuments(match);
        const entries = await LedgerEntryModel.find(match)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const uniqueAccountIds = Array.from(new Set(entries.map((e: any) => e.accountId))).filter(Boolean);
        const accounts = uniqueAccountIds.length > 0
            ? await AccountModel.find(
                { accountId: { $in: uniqueAccountIds } },
                { accountId: 1, ownerId: 1, type: 1, currency: 1 }
            ).lean()
            : [];
        const accountMap = new Map(accounts.map((a: any) => [a.accountId, a]));

        const data = entries.map((entry: any) => {
            const account = accountMap.get(entry.accountId);
            return {
                ...entry,
                account: account
                    ? { ownerId: account.ownerId, type: account.type, currency: account.currency }
                    : undefined
            };
        });

        return reply.send({
            success: true,
            data,
            meta: { total, page: pageNum, limit: limitNum },
            period: { start, end }
        });
    }

    /**
     * GET /finance/ledger/accounts?ownerId=&type=&includeInactive=
     */
    static async listAccounts(req: FastifyRequest, reply: FastifyReply) {
        const { ownerId, type, includeInactive } = req.query as any;
        const tenantId = getScopedTenantId(req);

        const filter: any = {};
        if (tenantId) filter.ownerId = tenantId;
        else if (ownerId) filter.ownerId = ownerId;
        if (type) filter.type = type;
        if (!includeInactive) filter.isActive = true;

        const accounts = await AccountModel.find(filter)
            .sort({ type: 1, ownerId: 1 })
            .lean();

        const data = accounts.map((a: any) => ({
            ...a,
            typeLabel: toAccountLabel(a.type),
            category: categoryForAccount(a.type)
        }));

        return reply.send({
            success: true,
            data,
            meta: { total: data.length }
        });
    }

    /**
     * GET /finance/ledger/trial-balance?startDate=&endDate=&operatorId=
     */
    static async trialBalance(req: FastifyRequest, reply: FastifyReply) {
        const { startDate, endDate, operatorId } = req.query as any;
        const tenantId = getScopedTenantId(req);

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        if (endDate) end.setUTCHours(23, 59, 59, 999);

        const match: any = {
            createdAt: { $gte: start, $lte: end }
        };
        const scopedOperatorId = tenantId || operatorId;
        if (scopedOperatorId) {
            const accountIds = await AccountModel.find({ ownerId: scopedOperatorId }, { accountId: 1 }).lean();
            const ownerAccountIds = accountIds.map((a: any) => a.accountId).filter(Boolean);

            if (ownerAccountIds.length > 0) {
                match.$or = [
                    { accountId: { $in: ownerAccountIds } },
                    { 'metadata.operatorId': scopedOperatorId }
                ];
            } else {
                match['metadata.operatorId'] = scopedOperatorId;
            }
        }

        const rows = await LedgerEntryModel.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { accountId: '$accountId', type: '$type' },
                    total: { $sum: '$amount' }
                }
            },
            {
                $group: {
                    _id: '$_id.accountId',
                    debit: {
                        $sum: {
                            $cond: [{ $eq: ['$_id.type', 'DEBIT'] }, '$total', 0]
                        }
                    },
                    credit: {
                        $sum: {
                            $cond: [{ $eq: ['$_id.type', 'CREDIT'] }, '$total', 0]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'accounts',
                    localField: '_id',
                    foreignField: 'accountId',
                    as: 'account'
                }
            },
            { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    accountId: '$_id',
                    debit: 1,
                    credit: 1,
                    net: { $subtract: ['$credit', '$debit'] },
                    account: {
                        ownerId: '$account.ownerId',
                        type: '$account.type',
                        currency: '$account.currency'
                    }
                }
            },
            { $sort: { accountId: 1 } }
        ]);

        const totals = rows.reduce(
            (acc: { debit: number; credit: number; net: number }, r: any) => {
                acc.debit += r.debit || 0;
                acc.credit += r.credit || 0;
                acc.net += r.net || 0;
                return acc;
            },
            { debit: 0, credit: 0, net: 0 }
        );

        return reply.send({
            success: true,
            data: { rows, totals },
            period: { start, end }
        });
    }

    /**
     * GET /finance/ledger/balance-sheet?ownerId=
     */
    static async balanceSheet(req: FastifyRequest, reply: FastifyReply) {
        const { ownerId } = req.query as any;
        const tenantId = getScopedTenantId(req);

        const filter: any = {};
        if (tenantId) filter.ownerId = tenantId;
        else if (ownerId) filter.ownerId = ownerId;

        const accounts = await AccountModel.find(filter).lean();

        const categories: any = {
            assets: [],
            liabilities: [],
            income: [],
            expenses: [],
            other: []
        };

        for (const account of accounts) {
            const category = categoryForAccount(account.type);
            categories[category].push({
                ...account,
                typeLabel: toAccountLabel(account.type)
            });
        }

        const totals = {
            assets: categories.assets.reduce((s: number, a: any) => s + (a.balance || 0), 0),
            liabilities: categories.liabilities.reduce((s: number, a: any) => s + (a.balance || 0), 0),
            income: categories.income.reduce((s: number, a: any) => s + (a.balance || 0), 0),
            expenses: categories.expenses.reduce((s: number, a: any) => s + (a.balance || 0), 0)
        };

        const netPosition = totals.assets - totals.liabilities;

        return reply.send({
            success: true,
            data: {
                categories,
                totals,
                netPosition
            }
        });
    }
}
