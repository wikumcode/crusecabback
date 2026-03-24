const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    console.log('--- Current DB State ---');
    const counts = {
        users: await prisma.user.count(),
        drivers: await prisma.user.count({ where: { role: 'DRIVER' } }),
        vendors: await prisma.user.count({ where: { role: 'VENDOR' } }),
        clients: await prisma.client.count(),
        vehicles: await prisma.vehicle.count(),
        bookings: await prisma.booking.count(),
        contracts: await prisma.contract.count(),
        odometers: await prisma.odometer.count(),
    };
    console.log(JSON.stringify(counts, null, 2));

    console.log('\n--- Sample Driver ---');
    const sampleDriver = await prisma.user.findFirst({
        where: { role: 'DRIVER' },
        select: { email: true }
    });
    console.log('Sample Driver Email:', sampleDriver ? sampleDriver.email : 'None');

    process.exit(0);
}

check().catch(err => {
    console.error(err);
    process.exit(1);
});
