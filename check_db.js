const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
    try {
        console.log('--- Database Diagnostic ---');

        const userCount = await prisma.user.count();
        const driverCount = await prisma.user.count({ where: { role: 'DRIVER' } });
        const vendorCount = await prisma.user.count({ where: { role: 'VENDOR' } });
        const clientCount = await prisma.client.count();
        const vehicleCount = await prisma.vehicle.count();
        const bookingCount = await prisma.booking.count();
        const contractCount = await prisma.contract.count();
        const odometerCount = await prisma.odometer.count();
        const vendorDetailsCount = await prisma.vendorDetails.count();
        const driverDetailsCount = await prisma.driverDetails.count();

        console.log(`Total Users: ${userCount}`);
        console.log(`Drivers: ${driverCount} (Details: ${driverDetailsCount})`);
        console.log(`Vendors: ${vendorCount} (Details: ${vendorDetailsCount})`);
        console.log(`Clients: ${clientCount}`);
        console.log(`Vehicles: ${vehicleCount}`);
        console.log(`Bookings: ${bookingCount}`);
        console.log(`Contracts: ${contractCount}`);
        console.log(`Odometers: ${odometerCount}`);

        if (driverCount > 0) {
            const drivers = await prisma.user.findMany({
                where: { role: 'DRIVER' },
                include: { driverDetails: true },
                take: 2
            });
            console.log('Sample Drivers:', JSON.stringify(drivers, null, 2));
        }

        if (vendorCount > 0) {
            const vendors = await prisma.user.findMany({
                where: { role: 'VENDOR' },
                include: { vendorDetails: true },
                take: 2
            });
            console.log('Sample Vendors:', JSON.stringify(vendors, null, 2));
        }

    } catch (error) {
        console.error('Diagnostic error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkData();
