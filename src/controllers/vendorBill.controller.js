const prisma = require('../lib/prisma');
const billingService = require('../services/billing.service');

const generateBillNumber = async () => {
    const lastBill = await prisma.vendorBill.findFirst({
        where: { billNumber: { startsWith: 'Vendor-Bill/' } },
        orderBy: { billNumber: 'desc' }
    });

    if (!lastBill || !lastBill.billNumber) {
        return 'Vendor-Bill/00001';
    }

    const lastCode = lastBill.billNumber;
    const numberPart = parseInt(lastCode.split('/')[1]);
    const nextNumber = numberPart + 1;
    return `Vendor-Bill/${String(nextNumber).padStart(5, '0')}`;
};

exports.getVendorBills = async (req, res) => {
    try {
        const { vendorId, vehicleId, status, dateRange, filterType } = req.query;

        const now = new Date();
        let start, end;

        if (filterType === 'today') {
            start = new Date(now.setHours(0, 0, 0, 0));
            end = new Date(now.setHours(23, 59, 59, 999));
        } else if (filterType === 'last7days') {
            start = new Date(now.setDate(now.getDate() - 7));
            end = new Date();
        } else if (filterType === 'last30days') {
            start = new Date(now.setDate(now.getDate() - 30));
            end = new Date();
        } else if (dateRange) {
            const [s, e] = JSON.parse(dateRange);
            start = new Date(s);
            end = new Date(e);
        }

        const bills = await prisma.vendorBill.findMany({
            where: {
                ...(vendorId && { vendorId }),
                ...(vehicleId && { vehicleId }),
                ...(status && { status }),
                ...((start && end) && {
                    createdAt: {
                        gte: start,
                        lte: end
                    }
                })
            },
            include: {
                vendor: { select: { name: true, email: true } },
                vehicle: { select: { licensePlate: true, vehicleModel: { include: { brand: true } } } },
                items: true,
                maintenances: true,
                expenses: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Format month name alphabetically for frontend if needed, 
        // though frontend can also handle this with date-fns.
        // We'll keep the raw data but the list view in frontend will format it.
        res.json(bills);
    } catch (error) {
        console.error("Get Vendor Bills Error:", error);
        res.status(500).json({ message: 'Failed to fetch vendor bills' });
    }
};

const fs = require('fs');

exports.createVendorBill = async (req, res) => {
    try {
        const { vendorId, vehicleId, month, year, items, description, monthlyPayment } = req.body;

        const billNumber = await generateBillNumber();

        const totalAmount = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

        const bill = await prisma.vendorBill.create({
            data: {
                billNumber,
                vendor: { connect: { id: vendorId } },
                vehicle: { connect: { id: vehicleId } },
                month: parseInt(month),
                year: parseInt(year),
                monthlyPayment: parseFloat(monthlyPayment) || totalAmount,
                repairDeductions: 0,
                expenseDeductions: 0,
                totalAmount: totalAmount,
                description,
                status: 'PENDING',
                items: {
                    create: items.map(item => ({
                        description: item.description,
                        amount: parseFloat(item.amount)
                    }))
                }
            },
            include: {
                items: true,
                vendor: { select: { name: true } },
                vehicle: { select: { licensePlate: true } }
            }
        });

        res.status(201).json(bill);
    } catch (error) {
        const errorDetails = {
            timestamp: new Date().toISOString(),
            body: req.body,
            error: error.message,
            code: error.code,
            meta: error.meta,
            stack: error.stack
        };
        console.error("Create Vendor Bill Error:", error);
        fs.writeFileSync('/tmp/vendor_bill_error.json', JSON.stringify(errorDetails, null, 2));
        res.status(400).json({ message: error.message || 'Failed to create vendor bill' });
    }
};

exports.updateVendorBill = async (req, res) => {
    try {
        const { id } = req.params;
        const { month, year, items, description, monthlyPayment } = req.body;

        // Check if bill exists and is pending
        const existingBill = await prisma.vendorBill.findUnique({ where: { id } });
        if (!existingBill) return res.status(404).json({ message: 'Bill not found' });
        if (existingBill.status !== 'PENDING') return res.status(400).json({ message: 'Only pending bills can be edited' });

        const totalAmount = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

        // Update bill and items using transaction
        const updatedBill = await prisma.$transaction(async (tx) => {
            // Delete existing items
            await tx.vendorBillItem.deleteMany({ where: { vendorBillId: id } });

            // Update main bill and create new items
            return await tx.vendorBill.update({
                where: { id },
                data: {
                    month: parseInt(month),
                    year: parseInt(year),
                    monthlyPayment: parseFloat(monthlyPayment) || totalAmount,
                    totalAmount: totalAmount,
                    description,
                    items: {
                        create: items.map(item => ({
                            description: item.description,
                            amount: parseFloat(item.amount)
                        }))
                    }
                },
                include: { items: true, vendor: { select: { name: true } }, vehicle: { select: { licensePlate: true } } }
            });
        });

        res.json(updatedBill);
    } catch (error) {
        console.error("Update Vendor Bill Error:", error);
        res.status(400).json({ message: error.message || 'Failed to update vendor bill' });
    }
};

exports.generateBills = async (req, res) => {
    try {
        const { month, year, vehicleId } = req.body;
        // Updated service will need to handle sequential numbering too
        const bills = await billingService.generateMonthlyVendorBills(month, year, vehicleId);
        res.json({ message: `Successfully generated ${bills.length} bills`, bills });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to generate bills' });
    }
};

exports.updateBillStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const bill = await prisma.vendorBill.update({
            where: { id },
            data: { status }
        });
        res.json(bill);
    } catch (error) {
        res.status(400).json({ message: 'Failed to update bill status' });
    }
};
