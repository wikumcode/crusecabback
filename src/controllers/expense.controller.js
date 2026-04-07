const prisma = require('../lib/prisma');

exports.getAllExpenses = async (req, res) => {
    try {
        const { vehicleId, startDate, endDate } = req.query;
        let where = {};

        if (vehicleId) {
            where.vehicleId = vehicleId;
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

        const expenses = await prisma.vehicleExpense.findMany({
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
            }
        });
        res.json(expenses);
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
