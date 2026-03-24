const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const vehicles = await prisma.vehicle.findMany({
        select: {
            licensePlate: true,
            imageUrl: true,
            vehicleModel: { select: { name: true, brand: { select: { name: true } } } }
        }
    });
    console.log(JSON.stringify(vehicles, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
