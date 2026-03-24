const prisma = require('../lib/prisma');

exports.getAllMaintenances = async (req, res) => {
    try {
        const maintenances = await prisma.maintenance.findMany({
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
                createdAt: 'desc'
            }
        });
        res.json(maintenances);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getMaintenanceById = async (req, res) => {
    try {
        const maintenance = await prisma.maintenance.findUnique({
            where: { id: req.params.id },
            include: { vehicle: true }
        });
        if (!maintenance) return res.status(404).json({ error: 'Maintenance not found' });
        res.json(maintenance);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createMaintenance = async (req, res) => {
    try {
        const { vehicleId, description, startDate, status } = req.body;
        const maintenance = await prisma.maintenance.create({
            data: {
                vehicleId,
                description,
                startDate: new Date(startDate),
                status: status || 'PENDING'
            }
        });

        // If status is IN_PROGRESS or PENDING, we might want to update vehicle status as well
        if (maintenance.status !== 'DONE') {
            await prisma.vehicle.update({
                where: { id: vehicleId },
                data: { status: 'MAINTENANCE' }
            });
        }

        res.status(201).json(maintenance);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateMaintenance = async (req, res) => {
    try {
        const { description, startDate, endDate, cost, status } = req.body;
        const currentMaintenance = await prisma.maintenance.findUnique({
            where: { id: req.params.id }
        });

        if (!currentMaintenance) return res.status(404).json({ error: 'Maintenance not found' });

        const updateData = {
            description,
            startDate: startDate ? new Date(startDate) : undefined,
            status
        };

        if (status === 'DONE') {
            if (!endDate || !cost) {
                return res.status(400).json({ error: 'Cost and End Date are required when status is DONE' });
            }
            updateData.endDate = new Date(endDate);
            updateData.cost = parseFloat(cost);
        } else if (endDate) {
            updateData.endDate = new Date(endDate);
        }

        const updatedMaintenance = await prisma.maintenance.update({
            where: { id: req.params.id },
            data: updateData
        });

        // Update vehicle status back to AVAILABLE if maintenance is DONE
        if (status === 'DONE') {
            await prisma.vehicle.update({
                where: { id: currentMaintenance.vehicleId },
                data: { status: 'AVAILABLE' }
            });
        }

        res.json(updatedMaintenance);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteMaintenance = async (req, res) => {
    try {
        const maintenance = await prisma.maintenance.findUnique({
            where: { id: req.params.id }
        });

        if (maintenance && maintenance.status !== 'DONE') {
            await prisma.vehicle.update({
                where: { id: maintenance.vehicleId },
                data: { status: 'AVAILABLE' }
            });
        }

        await prisma.maintenance.delete({
            where: { id: req.params.id }
        });
        res.json({ message: 'Maintenance deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
