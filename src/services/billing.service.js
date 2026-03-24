const prisma = require('../lib/prisma');
const { startOfMonth, endOfMonth, subMonths } = require('date-fns');

/**
 * Generates vendor bills for the previous month.
 */
exports.generateMonthlyVendorBills = async (month, year, vehicleId = null) => {
    try {
        // Default to last month if not specified
        const targetDate = (month && year)
            ? new Date(year, month - 1, 1)
            : subMonths(new Date(), 1);

        const m = targetDate.getMonth() + 1;
        const y = targetDate.getFullYear();

        const start = startOfMonth(targetDate);
        const end = endOfMonth(targetDate);

        console.log(`Generating bills for ${m}/${y}${vehicleId ? ` (Vehicle: ${vehicleId})` : ''}...`);

        // 1. Get 3rd party vehicles
        const vehicles = await prisma.vehicle.findMany({
            where: {
                ownership: 'THIRD_PARTY',
                ...(vehicleId && { id: vehicleId })
            },
            include: {
                paymentSchedules: {
                    where: { isActive: true },
                    take: 1
                }
            }
        });

        const results = [];

        for (const vehicle of vehicles) {
            if (!vehicle.vendorId) continue;

            // Check if a bill already exists for this vehicle/month/year to avoid duplicates
            const existingBill = await prisma.vendorBill.findFirst({
                where: {
                    vehicleId: vehicle.id,
                    month: m,
                    year: y
                }
            });
            if (existingBill) continue;

            const schedule = vehicle.paymentSchedules[0];
            const monthlyPayment = schedule ? schedule.monthlyAmount : 0;

            // 2. Find pending expenses/repairs paid by company
            // Filter: All items not realized yet, up to the end of the target month
            const pendingMaintenance = await prisma.maintenance.findMany({
                where: {
                    vehicleId: vehicle.id,
                    paidByCompany: true,
                    isRealized: false,
                    status: 'DONE',
                    endDate: { lte: end }
                }
            });

            const pendingExpenses = await prisma.vehicleExpense.findMany({
                where: {
                    vehicleId: vehicle.id,
                    paidByCompany: true,
                    isRealized: false,
                    date: { lte: end }
                }
            });

            const totalRepairs = pendingMaintenance.reduce((sum, m) => sum + (m.cost || 0), 0);
            const totalExpenses = pendingExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
            const totalDeductions = totalRepairs + totalExpenses;

            // Description logic: combine descriptions of all deducted items
            const repairDetails = pendingMaintenance.map(m => `${m.description} (Rs. ${m.cost})`).join(', ');
            const expenseDetails = pendingExpenses.map(e => `${e.description} (Rs. ${e.amount})`).join(', ');
            const deductionDescription = [
                repairDetails ? `Repairs: ${repairDetails}` : '',
                expenseDetails ? `Expenses: ${expenseDetails}` : ''
            ].filter(Boolean).join(' | ');

            const totalPayable = monthlyPayment - totalDeductions;

            let finalPayment = 0;
            let carriedOverBalance = 0;

            if (totalPayable > 0) {
                finalPayment = totalPayable;
                carriedOverBalance = 0;
            } else {
                finalPayment = 0;
                carriedOverBalance = Math.abs(totalPayable); // Amount still to be realized
            }

            // 3. Create Vendor Bill
            const lastBill = await prisma.vendorBill.findFirst({
                where: { billNumber: { startsWith: 'Vendor-Bill/' } },
                orderBy: { billNumber: 'desc' }
            });

            let billNumber = 'Vendor-Bill/00001';
            if (lastBill && lastBill.billNumber) {
                const numberPart = parseInt(lastBill.billNumber.split('/')[1]);
                billNumber = `Vendor-Bill/${String(numberPart + 1).padStart(5, '0')}`;
            }

            const bill = await prisma.vendorBill.create({
                data: {
                    billNumber,
                    vendor: { connect: { id: vehicle.vendorId } },
                    vehicle: { connect: { id: vehicle.id } },
                    month: m,
                    year: y,
                    billDate: targetDate, // Store the period date
                    monthlyPayment: monthlyPayment,
                    repairDeductions: totalRepairs,
                    expenseDeductions: totalExpenses,
                    totalAmount: finalPayment,
                    carriedOverBalance: carriedOverBalance,
                    description: deductionDescription || 'Regular monthly settlement',
                    status: 'PENDING'
                }
            });

            // 4. Link Maintenance and Expenses to this bill
            // If carriedOverBalance is 0, it means we fully covered all pending costs
            const isFullyRealized = carriedOverBalance === 0;

            for (const item of pendingMaintenance) {
                await prisma.maintenance.update({
                    where: { id: item.id },
                    data: { vendorBillId: bill.id, isRealized: isFullyRealized }
                });
            }

            for (const item of pendingExpenses) {
                await prisma.vehicleExpense.update({
                    where: { id: item.id },
                    data: { vendorBillId: bill.id, isRealized: isFullyRealized }
                });
            }

            results.push(bill);
        }

        return results;
    } catch (error) {
        console.error('Billing Service Error:', error);
        throw error;
    }
};
