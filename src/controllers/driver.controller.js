const { z } = require('zod');

const prisma = require('../lib/prisma');

const driverDetailsSchema = z.object({
    licenseNumber: z.string().min(1),
    expiryDate: z.string().datetime().or(z.string()), // Accept ISO string
    phoneNumber: z.string().min(1),
    address: z.string().optional(),
    userId: z.string().optional() // If linking to an existing user account
});

// Since DriverDetails is linked to User, we might often create a User with Role DRIVER
// Or just update an existing User to have DriverDetails.
// For simplicity in this iteration, we'll assume we are creating a User who is a Driver.

const createDriverSchema = z.object({
    email: z.string().email(),
    // password: z.string().min(6), // Password is now auto-generated
    name: z.string().min(1),
    licenseNumber: z.string().min(1),
    expiryDate: z.string(), // YYYY-MM-DD
    phoneNumber: z.string().min(1),
    address: z.string().min(1), // Required now
    nic: z.string().min(1), // Required
    licenseFrontUrl: z.string().optional(),
    licenseBackUrl: z.string().optional(),
    nicFrontUrl: z.string().optional(),
    nicBackUrl: z.string().optional(),
    driverImageUrl: z.string().optional(),
});

exports.createDriver = async (req, res) => {
    try {
        const data = createDriverSchema.parse(req.body);

        const result = await prisma.$transaction(async (prisma) => {
            const user = await prisma.user.create({
                data: {
                    email: data.email,
                    // password: hashedPassword, // Password is optional now
                    name: data.name,
                    role: 'DRIVER'
                }
            });

            const driverDetails = await prisma.driverDetails.create({
                data: {
                    userId: user.id,
                    licenseNumber: data.licenseNumber,
                    licenseExpiryDate: new Date(data.expiryDate),
                    phoneNumber: data.phoneNumber,
                    address: data.address,
                    nic: data.nic,
                    licenseFrontUrl: data.licenseFrontUrl,
                    licenseBackUrl: data.licenseBackUrl,
                    nicFrontUrl: data.nicFrontUrl,
                    nicBackUrl: data.nicBackUrl,
                    driverImageUrl: data.driverImageUrl
                }
            });

            return { user, driverDetails };
        });

        res.status(201).json(result);
    } catch (error) {
        console.error("Create Driver Error Full:", error);
        console.error("Create Driver Error Message:", error.message);
        res.status(400).json({ message: error.message || 'Failed to create driver' });
    }
};

exports.getDrivers = async (req, res) => {
    try {
        const drivers = await prisma.user.findMany({
            where: { role: 'DRIVER' },
            include: { driverDetails: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch drivers' });
    }
};

exports.getDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const driver = await prisma.user.findUnique({
            where: { id },
            include: { driverDetails: true }
        });
        if (!driver || driver.role !== 'DRIVER') return res.status(404).json({ message: 'Driver not found' });
        res.json(driver);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch driver' });
    }
};

exports.updateDriver = async (req, res) => {
    // Simplified update for now
    try {
        const { id } = req.params;
        const { name, phoneNumber, address, licenseNumber, expiryDate } = req.body;

        // Update User and DriverDetails
        const driver = await prisma.user.update({
            where: { id },
            data: {
                name,
                driverDetails: {
                    update: {
                        phoneNumber,
                        address,
                        licenseNumber,
                        licenseExpiryDate: expiryDate ? new Date(expiryDate) : undefined,
                        nic: req.body.nic,
                        licenseFrontUrl: req.body.licenseFrontUrl,
                        licenseBackUrl: req.body.licenseBackUrl,
                        nicFrontUrl: req.body.nicFrontUrl,
                        nicBackUrl: req.body.nicBackUrl,
                        driverImageUrl: req.body.driverImageUrl
                    }
                }
            },
            include: { driverDetails: true }
        });
        res.json(driver);
    } catch (error) {
        res.status(400).json({ message: 'Failed to update driver' });
    }
}

exports.deleteDriver = async (req, res) => {
    try {
        const { id } = req.params;
        // DriverDetails will be deleted via cascade if configured, but let's be explicit or rely on Prisma relation
        await prisma.user.delete({ where: { id } });
        res.json({ message: 'Driver deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete driver' });
    }
};
