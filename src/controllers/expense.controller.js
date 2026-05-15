const prisma = require('../lib/prisma');

exports.getAllExpenses = async (req, res) => {
    try {
        const { vehicleId, startDate, endDate, search } = req.query;
        let where = {};

        if (vehicleId) {
            where.vehicleId = vehicleId;
        }

        if (search) {
            where.OR = [
                { vehicle: { licensePlate: { contains: search, mode: 'insensitive' } } },
                { description: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (startDate || endDate) {
            where.date = {};
            if (startDate) {
                where.date.gte = new Date(startDate);
            }
            if (endDate) {
                where.date.lte = new Date(endDate);
            }
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const skip = (page - 1) * limit;

        const [expenses, totalCount] = await Promise.all([
            prisma.vehicleExpense.findMany({
                where,
                include: {
                    vehicle: {
                        include: {
                            vehicleModel: {
                                include: {
                                    brand: true
                                }
                            }
                        }
                    }
                },
                orderBy: {
                    date: 'desc'
                },
                skip,
                take: limit
            }),
            prisma.vehicleExpense.count({ where })
        ]);

        res.json({
            data: expenses,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getExpenseById = async (req, res) => {
    try {
        const expense = await prisma.vehicleExpense.findUnique({
            where: { id: req.params.id },
            include: { vehicle: true }
        });
        if (!expense) return res.status(404).json({ error: 'Expense not found' });
        res.json(expense);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createExpense = async (req, res) => {
    try {
        const { vehicleId, description, amount, date, paidByCompany } = req.body;
        const expense = await prisma.vehicleExpense.create({
            data: {
                vehicleId,
                description,
                amount: parseFloat(amount),
                date: new Date(date),
                paidByCompany: paidByCompany === true
            }
        });
        res.status(201).json(expense);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateExpense = async (req, res) => {
    try {
        const { vehicleId, description, amount, date, paidByCompany } = req.body;
        const updatedExpense = await prisma.vehicleExpense.update({
            where: { id: req.params.id },
            data: {
                vehicleId,
                description,
                amount: parseFloat(amount),
                date: new Date(date),
                paidByCompany: paidByCompany === true
            }
        });
        res.json(updatedExpense);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteExpense = async (req, res) => {
    try {
        await prisma.vehicleExpense.delete({
            where: { id: req.params.id }
        });
        res.json({ message: 'Expense deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
