const prisma = require('../lib/prisma'); // keep explicit import for quotation persistence
const { z } = require('zod');

const createQuotationSchema = z.object({
    customerMode: z.enum(['EXISTING', 'NEW']),
    customerId: z.string().optional().nullable(),
    customerName: z.string().min(1),
    customerEmail: z.string().email().optional().nullable(),
    customerType: z.enum(['LOCAL', 'FOREIGN', 'CORPORATE']),
    vehicleId: z.string().min(1),
    pickupDate: z.string().min(1),
    dropoffDate: z.string().min(1),
    rentalDays: z.number().int().min(1),
    dailyRate: z.number().nonnegative(),
    baseAmount: z.number().nonnegative(),
    extraCharges: z.array(z.object({
        description: z.string().optional().nullable(),
        amount: z.number().optional().default(0),
    })).default([]),
    extraAmount: z.number().nonnegative(),
    totalAmount: z.number().nonnegative(),
});

function buildQuotationNo(sequence, date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `QTN/${m}/${y}/${String(sequence).padStart(5, '0')}`;
}

function toDateAtMidnight(dateStr) {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

exports.createQuotation = async (req, res) => {
    try {
        const data = createQuotationSchema.parse(req.body || {});
        const issueDate = new Date();
        const validUntil = addDays(issueDate, 7);

        const pickupDate = toDateAtMidnight(data.pickupDate);
        const dropoffDate = toDateAtMidnight(data.dropoffDate);

        const created = await prisma.$transaction(async (tx) => {
            const seqKey = `quotation_sequence_${issueDate.getFullYear()}_${String(issueDate.getMonth() + 1).padStart(2, '0')}`;
            const setting = await tx.systemSetting.findUnique({ where: { key: seqKey } });
            const next = (setting ? Number(setting.value) || 0 : 0) + 1;
            if (setting) {
                await tx.systemSetting.update({ where: { key: seqKey }, data: { value: String(next) } });
            } else {
                await tx.systemSetting.create({ data: { key: seqKey, value: String(next) } });
            }

            const quotationNo = buildQuotationNo(next, issueDate);
            return tx.quotation.create({
                data: {
                    quotationNo,
                    issueDate,
                    validUntil,
                    customerMode: data.customerMode,
                    customerId: data.customerMode === 'EXISTING' && data.customerId ? data.customerId : null,
                    customerName: data.customerName,
                    customerEmail: data.customerEmail || null,
                    customerType: data.customerType,
                    vehicleId: data.vehicleId,
                    pickupDate,
                    dropoffDate,
                    rentalDays: data.rentalDays,
                    dailyRate: data.dailyRate,
                    baseAmount: data.baseAmount,
                    extraChargesJson: JSON.stringify(data.extraCharges || []),
                    extraAmount: data.extraAmount,
                    totalAmount: data.totalAmount,
                    createdByUserId: req.user?.id || null,
                },
                include: {
                    vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                    customer: true,
                },
            });
        });

        res.status(201).json(created);
    } catch (error) {
        console.error('Create Quotation Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to create quotation' });
    }
};

exports.listQuotations = async (req, res) => {
    try {
        const rows = await prisma.quotation.findMany({
            include: {
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                customer: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        const mapped = rows.map((r) => ({
            ...r,
            extraCharges: (() => {
                try {
                    const arr = JSON.parse(r.extraChargesJson || '[]');
                    return Array.isArray(arr) ? arr : [];
                } catch {
                    return [];
                }
            })(),
        }));
        res.json(mapped);
    } catch (error) {
        console.error('List Quotations Error:', error);
        res.status(500).json({ message: 'Failed to fetch quotations' });
    }
};

exports.getQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const row = await prisma.quotation.findUnique({
            where: { id },
            include: {
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                customer: true,
            },
        });
        if (!row) return res.status(404).json({ message: 'Quotation not found' });
        const extraCharges = (() => {
            try {
                const arr = JSON.parse(row.extraChargesJson || '[]');
                return Array.isArray(arr) ? arr : [];
            } catch {
                return [];
            }
        })();
        res.json({ ...row, extraCharges });
    } catch (error) {
        console.error('Get Quotation Error:', error);
        res.status(500).json({ message: 'Failed to fetch quotation' });
    }
};

