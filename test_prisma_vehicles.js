require('dotenv').config();
const prisma = require('./src/lib/prisma');

async function testQuery() {
    try {
        console.log('Testing simple user count...');
        const userCount = await prisma.user.count();
        console.log('User Count:', userCount);

        console.log('Testing simple vehicle count...');
        const vehicleCount = await prisma.vehicle.count();
        console.log('Vehicle Count:', vehicleCount);

        console.log('Testing vehicle findMany basic...');
        const vehiclesBasic = await prisma.vehicle.findMany({ take: 1 });
        console.log('Vehicles basic found:', vehiclesBasic.length);

        console.log('Testing vehicle findMany with include...');
        const vehiclesWithInclude = await prisma.vehicle.findMany({
            take: 1,
            include: { vehicleModel: { include: { brand: true } } }
        });
        console.log('Vehicles with include found:', vehiclesWithInclude.length);

        console.log('Success!');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

testQuery();
