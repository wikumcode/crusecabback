const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const prisma = new PrismaClient();

async function main() {
    const email = 'superadmin@codebraze.lk';
    console.log(`Checking for user with email: ${email}`);
    const user = await prisma.user.findUnique({
        where: { email },
    });

    if (user) {
        console.log('User found:', user);
    } else {
        console.log('User NOT found');
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
