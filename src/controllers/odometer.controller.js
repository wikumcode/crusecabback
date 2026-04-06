const { z } = require('zod');

const prisma = require('../lib/prisma');

const odometerSchema = z.object({
    vehicleId: z.string().min(1),
    reading: z.number().int(),
    date: z.string().optional().transform((str) => str ? new Date(str) : undefined),
    source: z.string().optional(),
});

exports.createOdometer = async (req, res) => {
    try {
        const data = odometerSchema.parse(req.body);
        const odometer = await prisma.odometer.create({ data });
        // Also update the vehicle's lastOdometer
        await prisma.vehicle.update({
            where: { id: data.vehicleId },
            data: { lastOdometer: data.reading }
        });

        res.status(201).json(odometer);
    } catch (error) {
        console.error("Create Odometer Error:", error);
        res.status(400).json({ message: error.message || 'Failed to create odometer record' });
    }
};

exports.getOdometersByVehicle = async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const odometers = await prisma.odometer.findMany({
            where: { vehicleId },
            orderBy: { date: 'desc' },
            include: { 
                vehicle: {
                    include: {
                        vehicleModel: { include: { brand: true } },
                        fleetCategory: true
                    }
                }
            }
        });
        res.json(odometers);
    } catch (error) {
        console.error("Get Odometers Error:", error);
        res.status(500).json({ message: 'Failed to fetch odometer records' });
    }
};

exports.getAllOdometers = async (req, res) => {
    try {
        const odometers = await prisma.odometer.findMany({
            orderBy: { date: 'desc' },
            include: { 
                vehicle: {
                    include: {
                        vehicleModel: { include: { brand: true } },
                        fleetCategory: true
                    }
                }
            }
        });
        res.json(odometers);
    } catch (error) {
        console.error("Get All Odometers Error:", error);
        res.status(500).json({ message: 'Failed to fetch odometer records' });
    }
};
