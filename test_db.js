const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const vs = await prisma.vehicle.findMany({
        where: { licensePlate: { startsWith: 'LB-10' } },
        select: { licensePlate: true, imageUrl: true }
    });
    console.log(JSON.stringify(vs.slice(0, 3), null, 2));
}
main().finally(() => prisma.$disconnect());
