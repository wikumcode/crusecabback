const prisma = require('../lib/prisma');
const { startOfDay, endOfDay } = require('date-fns');

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

        const maintenances = await prisma.maintenance.findMany({
            where: {
                ...vehicleWhere,
                endDate: (start || end) ? dateFilter : undefined,
                status: 'DONE'
            },
            orderBy: { endDate: 'desc' }
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
