const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
    const res = await prisma.setting.updateMany({
        where: { value: { contains: 'fa832e' } },
        data: { value: '#fa5a28' }
    });
    console.log("Updated", res.count, "records.");

    const res2 = await prisma.setting.updateMany({
        where: { value: { contains: 'FA832E' } },
        data: { value: '#FA5A28' }
    });
    console.log("Updated (upper)", res2.count, "records.");
}
fix().finally(() => prisma.$disconnect());
