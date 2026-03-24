const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listUsers() {
    const users = await prisma.user.findMany();
    console.log('All Users:', JSON.stringify(users, null, 2));
    await prisma.$disconnect();
}

listUsers();
