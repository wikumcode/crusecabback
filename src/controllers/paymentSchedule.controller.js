const prisma = require('../lib/prisma');

exports.getPaymentSchedules = async (req, res) => {
    try {
        const { vehicleId } = req.query;
        const schedules = await prisma.vehiclePaymentSchedule.findMany({
            where: vehicleId ? { vehicleId } : {},
            orderBy: { startDate: 'desc' },
            include: { vehicle: true }
        });
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch payment schedules' });
    }
};

exports.createPaymentSchedule = async (req, res) => {
    try {
        const { vehicleId, startDate, endDate, monthlyAmount, isActive } = req.body;

        // If isActive is true, deactivate others for this vehicle
        if (isActive) {
            await prisma.vehiclePaymentSchedule.updateMany({
                where: { vehicleId, isActive: true },
                data: { isActive: false }
            });
        }

        const schedule = await prisma.vehiclePaymentSchedule.create({
            data: {
                vehicleId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                monthlyAmount: parseFloat(monthlyAmount),
                isActive: isActive ?? true
            }
        });
        res.status(201).json(schedule);
    } catch (error) {
        res.status(400).json({ message: error.message || 'Failed to create payment schedule' });
    }
};

exports.updatePaymentSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate, monthlyAmount, isActive } = req.body;

        const currentSchedule = await prisma.vehiclePaymentSchedule.findUnique({ where: { id } });
        if (!currentSchedule) return res.status(404).json({ message: 'Schedule not found' });

        if (isActive && !currentSchedule.isActive) {
            await prisma.vehiclePaymentSchedule.updateMany({
                where: { vehicleId: currentSchedule.vehicleId, isActive: true },
                data: { isActive: false }
            });
        }

        const schedule = await prisma.vehiclePaymentSchedule.update({
            where: { id },
            data: {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                monthlyAmount: monthlyAmount ? parseFloat(monthlyAmount) : undefined,
                isActive
            }
        });
        res.json(schedule);
    } catch (error) {
        res.status(400).json({ message: error.message || 'Failed to update payment schedule' });
    }
};

exports.deletePaymentSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.vehiclePaymentSchedule.delete({ where: { id } });
        res.json({ message: 'Schedule deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete payment schedule' });
    }
};
