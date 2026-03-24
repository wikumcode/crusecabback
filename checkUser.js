const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUser() {
    const email = 'superadmin@codebraze.lk';
    const user = await prisma.user.findUnique({
        where: { email },
    });
    console.log('User found:', JSON.stringify(user, null, 2));
    await prisma.$disconnect();
}

checkUser();
