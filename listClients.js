const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listClients() {
    const clients = await prisma.client.findMany();
    console.log('All Clients:', JSON.stringify(clients, null, 2));
    await prisma.$disconnect();
}

listClients();
