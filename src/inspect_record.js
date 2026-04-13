
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
    try {
        const contract = await prisma.contract.findUnique({
            where: { contractNo: 'CON/04/2026/00011' },
            include: { vehicle: true }
        });
        
        console.log('--- CONTRACT ---');
        console.log(JSON.stringify(contract, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

inspect();
