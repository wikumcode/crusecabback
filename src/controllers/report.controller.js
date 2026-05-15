const prisma = require('../lib/prisma');
const { startOfDay, endOfDay, differenceInCalendarDays } = require('date-fns');

const AGING_BUCKET_KEYS = ['0_30', '31_60', '61_90', '90_PLUS'];
const AGING_BUCKET_LABELS = ['0–30 days', '31–60 days', '61–90 days', '90+ days'];

function bucketIndexForAge(ageDays) {
    if (ageDays <= 30) return 0;
    if (ageDays <= 60) return 1;
    if (ageDays <= 90) return 2;
    return 3;
}

function emptyBuckets() {
    return [0, 0, 0, 0];
}

function customerDisplayName(c) {
    if (!c) return 'Unknown';
    return (
        c.companyName?.trim() ||
        c.name?.trim() ||
        c.contactPersonName?.trim() ||
        c.email?.trim() ||
        c.code ||
        'Unknown'
    );
}

exports.getVehiclePL = async (req, res) => {
    try {
        const { vehicleId, startDate, endDate } = req.query;
        const isCompanyView = !vehicleId || vehicleId === 'all';
        const start = startDate ? startOfDay(new Date(startDate)) : undefined;
        const end = endDate ? endOfDay(new Date(endDate)) : undefined;

        const dateFilter = {
            ...(start && { gte: start }),
            ...(end && { lte: end })
        };

        // 1. Get Vehicle details (or company summary)
        let vehicle = null;
        if (!isCompanyView) {
            vehicle = await prisma.vehicle.findUnique({
                where: { id: vehicleId },
                include: {
                    vehicleModel: { include: { brand: true } },
                    vendor: { select: { name: true } }
                }
            });
            if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
        }

        const vehicleWhere = isCompanyView ? {} : { vehicleId };

        // 2. Calculate Income (Ledger INCOME entries from invoice payments)
        const incomeEntries = await prisma.ledgerEntry.findMany({
            where: {
                ...vehicleWhere,
                type: 'INCOME',
                createdAt: (start || end) ? dateFilter : undefined
            },
            include: {
                contract: true,
                customer: true,
                invoice: true,
            },
            orderBy: { createdAt: 'desc' }
        });
        const totalIncome = incomeEntries.reduce((sum, e) => sum + (e.amount || 0), 0);

        // Liability entries (Security deposits) for drill-down
        const liabilityEntries = await prisma.ledgerEntry.findMany({
            where: {
                ...vehicleWhere,
                type: 'LIABILITY',
                createdAt: (start || end) ? dateFilter : undefined
            },
            include: {
                contract: true,
                customer: true,
                invoice: true
            },
            orderBy: { createdAt: 'desc' }
        });
        const totalLiabilities = liabilityEntries.reduce((sum, e) => sum + (e.amount || 0), 0);

        // 3. Calculate Expenses
        let totalExpenses = 0;
        let breakdown = {
            income: totalIncome,
            liabilities: totalLiabilities,
            maintenance: 0,
            directExpenses: 0,
            vendorPayments: 0,
            unrealizedCosts: 0
        };

        // For maintenance: use startDate as the date anchor (endDate is optional even for DONE records)
        const maintenances = await prisma.maintenance.findMany({
            where: {
                ...vehicleWhere,
                status: 'DONE',
                ...(start || end ? { startDate: dateFilter } : {})
            },
            orderBy: { startDate: 'desc' }
        });
        breakdown.maintenance = maintenances.reduce((sum, m) => sum + (m.cost || 0), 0);

        const expenses = await prisma.vehicleExpense.findMany({
            where: {
                ...vehicleWhere,
                date: (start || end) ? dateFilter : undefined
            },
            orderBy: { date: 'desc' }
        });
        breakdown.directExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

        // Vendor payments apply for 3rd party vehicles and company view mixed fleet.
        const vendorBills = await prisma.vendorBill.findMany({
            where: {
                ...(isCompanyView ? {} : { vehicleId }),
                createdAt: (start || end) ? dateFilter : undefined,
                status: 'PAID'
            },
            include: {
                vendor: { select: { id: true, name: true, email: true } },
                items: true
            },
            orderBy: { createdAt: 'desc' }
        });
        breakdown.vendorPayments = vendorBills.reduce((sum, b) => sum + b.monthlyPayment, 0);

        // Unrealized costs are those paid by company but not yet deducted from bills within this period
        const unrealizedMaint = maintenances.filter(m => m.paidByCompany && !m.isRealized);
        const unrealizedExp = expenses.filter(e => e.paidByCompany && !e.isRealized);

        breakdown.unrealizedCosts = unrealizedMaint.reduce((sum, m) => sum + (m.cost || 0), 0) +
            unrealizedExp.reduce((sum, e) => sum + (e.amount || 0), 0);

        // Total Period Expenses should be consistent with what the UI shows as expense lines.
        // Note: unrealizedCosts is a subset (informational) and is NOT added again to avoid double counting.
        totalExpenses = breakdown.maintenance + breakdown.directExpenses + breakdown.vendorPayments;

        const profitLoss = totalIncome - totalExpenses;

        let fleetBreakdown = [];
        if (isCompanyView) {
            // Collect all vehicle IDs that appear in the period data (no extra full-fleet query)
            const activeVehicleIds = [
                ...new Set([
                    ...incomeEntries.map(e => e.vehicleId),
                    ...maintenances.map(m => m.vehicleId),
                    ...expenses.map(e => e.vehicleId),
                    ...vendorBills.map(b => b.vehicleId),
                ].filter(Boolean))
            ];

            // Fetch only the vehicles that actually have activity in this period
            const activeVehicles = activeVehicleIds.length > 0
                ? await prisma.vehicle.findMany({
                    where: { id: { in: activeVehicleIds } },
                    include: { vehicleModel: { include: { brand: true } } }
                })
                : [];

            const vehicleMap = new Map(activeVehicles.map(v => [v.id, v]));

            fleetBreakdown = activeVehicleIds.map(vid => {
                const v = vehicleMap.get(vid);
                if (!v) return null;

                const vIncome = incomeEntries
                    .filter(e => e.vehicleId === vid)
                    .reduce((sum, e) => sum + (e.amount || 0), 0);

                const vMaint = maintenances
                    .filter(m => m.vehicleId === vid)
                    .reduce((sum, m) => sum + (m.cost || 0), 0);

                const vExp = expenses
                    .filter(e => e.vehicleId === vid)
                    .reduce((sum, e) => sum + (e.amount || 0), 0);

                const vVendor = vendorBills
                    .filter(b => b.vehicleId === vid)
                    .reduce((sum, b) => sum + (b.monthlyPayment || 0), 0);

                const vTotalExp = vMaint + vExp + vVendor;

                return {
                    id: v.id,
                    plate: v.licensePlate,
                    model: `${v.vehicleModel?.brand?.name || ''} ${v.vehicleModel?.name || ''}`.trim(),
                    income: vIncome,
                    expenses: vTotalExp,
                    profitLoss: vIncome - vTotalExp
                };
            }).filter(Boolean);

            fleetBreakdown.sort((a, b) => b.profitLoss - a.profitLoss);
        }

        const incomeUpfront = incomeEntries
            .filter(e => String(e.invoice?.type || '').toUpperCase() === 'UPFRONT')
            .reduce((sum, e) => sum + (e.amount || 0), 0);
        const incomeReturn = incomeEntries
            .filter(e => String(e.invoice?.type || '').toUpperCase() === 'RETURN')
            .reduce((sum, e) => sum + (e.amount || 0), 0);
        const incomeOther = totalIncome - incomeUpfront - incomeReturn;

        const liabilityCreated = liabilityEntries
            .filter(e => (e.amount || 0) > 0)
            .reduce((sum, e) => sum + (e.amount || 0), 0);
        const liabilitySettled = liabilityEntries
            .filter(e => (e.amount || 0) < 0)
            .reduce((sum, e) => sum + Math.abs(e.amount || 0), 0);

        res.json({
            vehicle: {
                id: isCompanyView ? null : vehicle.id,
                plate: isCompanyView ? 'ALL VEHICLES' : vehicle.licensePlate,
                model: isCompanyView ? 'Company-Wide Financial View' : `${vehicle.vehicleModel.brand.name} ${vehicle.vehicleModel.name}`,
                ownership: isCompanyView ? 'MIXED' : vehicle.ownership,
                vendor: isCompanyView ? null : vehicle.vendor?.name
            },
            isCompanyView,
            fleetBreakdown,
            period: { start, end },
            breakdown,
            breakdownCards: {
                income: {
                    upfront: incomeUpfront,
                    return: incomeReturn,
                    other: incomeOther
                },
                liabilities: {
                    created: liabilityCreated,
                    settled: liabilitySettled,
                    net: totalLiabilities
                }
            },
            income: incomeEntries.map(e => ({
                id: e.id,
                amount: e.amount,
                currency: e.currency,
                createdAt: e.createdAt,
                description: e.description,
                invoiceNo: e.invoice?.invoiceNo,
                invoiceId: e.invoiceId,
                invoiceType: e.invoice?.type,
                contractNo: e.contract?.contractNo,
                contractId: e.contractId,
                customer: e.customer ? { id: e.customer.id, name: e.customer.name, email: e.customer.email } : null,
            })),
            totalIncome,
            liabilities: liabilityEntries.map(e => ({
                id: e.id,
                amount: e.amount,
                currency: e.currency,
                createdAt: e.createdAt,
                contractNo: e.contract?.contractNo,
                contractId: e.contractId,
                customer: e.customer ? { id: e.customer.id, name: e.customer.name, email: e.customer.email } : null,
                invoiceNo: e.invoice?.invoiceNo,
                invoiceId: e.invoiceId
            })),
            totalExpenses,
            expenses: {
                maintenance: maintenances.map(m => ({
                    id: m.id,
                    date: m.endDate || m.startDate,
                    description: m.description,
                    amount: m.cost || 0,
                    paidByCompany: m.paidByCompany,
                    isRealized: m.isRealized
                })),
                direct: expenses.map(e => ({
                    id: e.id,
                    date: e.date,
                    category: e.category,
                    description: e.description,
                    amount: e.amount || 0,
                    paidByCompany: e.paidByCompany,
                    isRealized: e.isRealized
                })),
                vendorBills: vendorBills.map(b => ({
                    id: b.id,
                    date: b.createdAt,
                    vendor: b.vendor ? { id: b.vendor.id, name: b.vendor.name, email: b.vendor.email } : null,
                    billNumber: b.billNumber,
                    amount: b.monthlyPayment || 0,
                    month: b.month,
                    year: b.year,
                }))
            },
            profitLoss
        });
    } catch (error) {
        console.error('P&L Error:', error);
        res.status(500).json({ message: 'Failed to calculate P&L' });
    }
};

/**
 * Customer receivables aging (summary + detail) as of a date.
 * - Open amount: invoices still ISSUED as of asOf, or PAID but only after asOf (full total was due as of asOf).
 * - Age: calendar days from invoice issue date (createdAt, start of day) to as-of (end of day).
 * - VOID invoices excluded. Credit notes set invoice to VOID, so they drop out automatically.
 */
exports.getCustomerAging = async (req, res) => {
    try {
        const { asOfDate, customerId, vehicleId } = req.query;
        const asOf = asOfDate ? new Date(asOfDate) : new Date();
        if (Number.isNaN(asOf.getTime())) {
            return res.status(400).json({ message: 'Invalid asOfDate' });
        }
        const asOfEnd = endOfDay(asOf);

        const where = {
            status: { not: 'VOID' },
            createdAt: { lte: asOfEnd },
            OR: [
                { status: 'ISSUED' },
                { status: 'PAID', paidAt: { gt: asOfEnd } },
            ],
            ...(customerId && typeof customerId === 'string' && customerId.trim()
                ? { customerId: customerId.trim() }
                : {}),
        };

        const invoices = await prisma.invoice.findMany({
            where,
            include: {
                customer: true,
                contract: { select: { id: true, contractNo: true } },
                vehicle: {
                    select: {
                        licensePlate: true,
                        vehicleModel: { select: { name: true, brand: { select: { name: true } } } },
                    },
                },
            },
            orderBy: [{ customerId: 'asc' }, { createdAt: 'asc' }],
        });

        const lines = [];
        const grandBuckets = emptyBuckets();
        let grandTotal = 0;

        for (const inv of invoices) {
            const outstanding = Number(inv.total) || 0;
            const issueStart = startOfDay(new Date(inv.createdAt));
            const ageDays = Math.max(0, differenceInCalendarDays(asOfEnd, issueStart));
            const bi = bucketIndexForAge(ageDays);
            const bucketAmounts = emptyBuckets();
            bucketAmounts[bi] = outstanding;

            for (let i = 0; i < 4; i += 1) {
                grandBuckets[i] += bucketAmounts[i];
            }
            grandTotal += outstanding;

            const c = inv.customer;
            lines.push({
                customerId: inv.customerId,
                customerName: customerDisplayName(c),
                customerCode: c?.code || null,
                invoiceId: inv.id,
                invoiceNo: inv.invoiceNo,
                invoiceType: inv.type,
                currency: inv.currency || 'LKR',
                issueDate: inv.createdAt,
                ageDays,
                status: inv.status,
                paidAt: inv.paidAt || null,
                contractNo: inv.contract?.contractNo || null,
                vehiclePlate: inv.vehicle?.licensePlate || null,
                vehicleModel: inv.vehicle?.vehicleModel
                    ? `${inv.vehicle.vehicleModel.brand?.name || ''} ${inv.vehicle.vehicleModel.name || ''}`.trim()
                    : null,
                outstanding,
                bucketAmounts,
                bucketKey: AGING_BUCKET_KEYS[bi],
            });
        }

        const byCustomerMap = new Map();
        for (const row of lines) {
            if (!byCustomerMap.has(row.customerId)) {
                byCustomerMap.set(row.customerId, {
                    customerId: row.customerId,
                    customerName: row.customerName,
                    customerCode: row.customerCode,
                    bucketAmounts: emptyBuckets(),
                    total: 0,
                    lineCount: 0,
                });
            }
            const agg = byCustomerMap.get(row.customerId);
            agg.total += row.outstanding;
            agg.lineCount += 1;
            for (let i = 0; i < 4; i += 1) {
                agg.bucketAmounts[i] += row.bucketAmounts[i];
            }
        }

        const byCustomer = Array.from(byCustomerMap.values()).sort((a, b) =>
            String(a.customerName).localeCompare(String(b.customerName))
        );

        res.json({
            asOf: asOfEnd.toISOString(),
            definition:
                'Amounts are open customer invoices as of the as-of date. Aging is from invoice issue date (created) into buckets: 0–30, 31–60, 61–90, 90+ days.',
            buckets: AGING_BUCKET_KEYS.map((key, i) => ({ key, label: AGING_BUCKET_LABELS[i] })),
            grandBuckets,
            grandTotal,
            byCustomer,
            lines,
        });
    } catch (error) {
        console.error('Customer aging report error:', error);
        res.status(500).json({ message: 'Failed to build customer aging report' });
    }
};

function parseTimeTo24h(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const t = timeStr.trim().toUpperCase();

    const m24 = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m24) {
        const h = Number(m24[1]);
        const min = Number(m24[2]);
        if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { h, min };
        return null;
    }

    const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(t);
    if (m12) {
        let h = Number(m12[1]);
        const min = Number(m12[2]);
        const ap = m12[3];
        if (h < 1 || h > 12 || min < 0 || min > 59) return null;
        if (ap === 'PM' && h !== 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        return { h, min };
    }

    return null;
}

function combineDateAndTime(dateVal, timeStr) {
    if (!dateVal) return null;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(d.getTime())) return null;
    const parsed = parseTimeTo24h(timeStr);
    if (!parsed) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), parsed.h, parsed.min, 0, 0);
}

exports.getOverdueContracts = async (req, res) => {
    try {
        const { asOfDate, customerId, vehicleId } = req.query;
        const asOf = asOfDate ? new Date(asOfDate) : new Date();
        if (Number.isNaN(asOf.getTime())) {
            return res.status(400).json({ message: 'Invalid asOfDate' });
        }
        const asOfEnd = endOfDay(asOf);

        const contracts = await prisma.contract.findMany({
            where: {
                status: { in: ['UPCOMING', 'IN_PROGRESS', 'RETURN'] },
                ...(customerId && typeof customerId === 'string' && customerId.trim()
                    ? { customerId: customerId.trim() }
                    : {}),
                ...(vehicleId && typeof vehicleId === 'string' && vehicleId.trim()
                    ? { vehicleId: vehicleId.trim() }
                    : {}),
            },
            include: {
                customer: true,
                vehicle: {
                    select: {
                        licensePlate: true,
                        vehicleModel: { select: { name: true, brand: { select: { name: true } } } },
                    },
                },
                invoices: {
                    select: {
                        id: true,
                        invoiceNo: true,
                        total: true,
                        status: true,
                        type: true,
                    },
                },
            },
            orderBy: [{ dropoffDate: 'asc' }, { createdAt: 'asc' }],
        });

        const lines = [];
        const summaryByStatus = {
            UPCOMING: { count: 0, totalDue: 0 },
            IN_PROGRESS: { count: 0, totalDue: 0 },
            RETURN: { count: 0, totalDue: 0 },
        };

        for (const c of contracts) {
            const dueAt = combineDateAndTime(c.dropoffDate, c.dropoffTime) || endOfDay(new Date(c.dropoffDate));
            if (dueAt > asOfEnd) continue;

            const overdueDays = Math.max(0, differenceInCalendarDays(asOfEnd, dueAt));
            const customerName = customerDisplayName(c.customer);
            const openInvoices = (c.invoices || []).filter((inv) => inv.status === 'ISSUED');
            const amountDue = openInvoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
            const statusKey = ['UPCOMING', 'IN_PROGRESS', 'RETURN'].includes(c.status) ? c.status : 'IN_PROGRESS';
            summaryByStatus[statusKey].count += 1;
            summaryByStatus[statusKey].totalDue += amountDue;

            lines.push({
                contractId: c.id,
                contractNo: c.contractNo || '-',
                status: c.status,
                customerId: c.customerId,
                customerName,
                customerCode: c.customer?.code || null,
                vehiclePlate: c.vehicle?.licensePlate || null,
                vehicleModel: c.vehicle?.vehicleModel
                    ? `${c.vehicle.vehicleModel.brand?.name || ''} ${c.vehicle.vehicleModel.name || ''}`.trim()
                    : null,
                pickupDate: c.pickupDate,
                pickupTime: c.pickupTime,
                dropoffDate: c.dropoffDate,
                dropoffTime: c.dropoffTime,
                dueAt,
                overdueDays,
                amountDue,
                openInvoices: openInvoices.map((inv) => ({
                    id: inv.id,
                    invoiceNo: inv.invoiceNo,
                    type: inv.type,
                    total: inv.total,
                })),
            });
        }

        lines.sort((a, b) => b.overdueDays - a.overdueDays);
        const totalAmountDue = lines.reduce((sum, l) => sum + (l.amountDue || 0), 0);

        res.json({
            asOf: asOfEnd.toISOString(),
            count: lines.length,
            totalAmountDue,
            summaryByStatus,
            definition:
                'Overdue contracts are those in UPCOMING, IN_PROGRESS, or RETURN status where dropoff date/time is before the as-of date.',
            lines,
        });
    } catch (error) {
        console.error('Overdue contracts report error:', error);
        res.status(500).json({ message: 'Failed to build overdue contracts report' });
    }
};

/**
 * Scheduled rental end (dropoff date + time) within a date range — vehicle-centric expiry list.
 * Excludes CANCELLED. Includes COMPLETED so historical rows in the window still appear if needed.
 */
exports.getContractExpiryDetails = async (req, res) => {
    try {
        const { fromDate, toDate, customerId, vehicleId } = req.query;
        const today = new Date();
        const from = fromDate ? new Date(fromDate) : today;
        const to = toDate ? new Date(toDate) : new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            return res.status(400).json({ message: 'Invalid fromDate or toDate' });
        }
        const rangeStart = startOfDay(from);
        const rangeEnd = endOfDay(to);
        if (rangeStart > rangeEnd) {
            return res.status(400).json({ message: 'fromDate must be on or before toDate' });
        }

        const contracts = await prisma.contract.findMany({
            where: {
                status: { not: 'CANCELLED' },
                ...(customerId && typeof customerId === 'string' && customerId.trim()
                    ? { customerId: customerId.trim() }
                    : {}),
                ...(vehicleId && typeof vehicleId === 'string' && vehicleId.trim()
                    ? { vehicleId: vehicleId.trim() }
                    : {}),
                dropoffDate: {
                    gte: new Date(rangeStart.getTime() - 24 * 60 * 60 * 1000),
                    lte: new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000),
                },
            },
            include: {
                customer: true,
                vehicle: {
                    select: {
                        id: true,
                        licensePlate: true,
                        vehicleModel: { select: { name: true, brand: { select: { name: true } } } },
                    },
                },
            },
            orderBy: [{ dropoffDate: 'asc' }, { createdAt: 'asc' }],
        });

        const asOfDay = startOfDay(today);
        const lines = [];

        for (const c of contracts) {
            const scheduledExpiry =
                combineDateAndTime(c.dropoffDate, c.dropoffTime) || endOfDay(new Date(c.dropoffDate));
            if (scheduledExpiry < rangeStart || scheduledExpiry > rangeEnd) continue;

            const daysUntilExpiry = differenceInCalendarDays(startOfDay(scheduledExpiry), asOfDay);

            lines.push({
                contractId: c.id,
                contractNo: c.contractNo || '-',
                status: c.status,
                customerId: c.customerId,
                customerName: customerDisplayName(c.customer),
                customerCode: c.customer?.code || null,
                vehicleId: c.vehicleId,
                vehiclePlate: c.vehicle?.licensePlate || null,
                vehicleModel: c.vehicle?.vehicleModel
                    ? `${c.vehicle.vehicleModel.brand?.name || ''} ${c.vehicle.vehicleModel.name || ''}`.trim()
                    : null,
                pickupDate: c.pickupDate,
                pickupTime: c.pickupTime,
                dropoffDate: c.dropoffDate,
                dropoffTime: c.dropoffTime,
                scheduledExpiry,
                daysUntilExpiry,
                actualReturnDate: c.actualReturnDate || null,
                actualReturnTime: c.actualReturnTime || null,
            });
        }

        lines.sort((a, b) => new Date(a.scheduledExpiry) - new Date(b.scheduledExpiry));

        const summaryByStatus = lines.reduce((acc, row) => {
            const k = row.status || 'UNKNOWN';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
        }, {});

        res.json({
            period: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
            asOfDay: asOfDay.toISOString(),
            count: lines.length,
            summaryByStatus,
            definition:
                'Contracts whose scheduled drop-off (expiry) falls between from and to dates. Cancelled contracts are excluded.',
            lines,
        });
    } catch (error) {
        console.error('Contract expiry report error:', error);
        res.status(500).json({ message: 'Failed to build contract expiry report' });
    }
};
