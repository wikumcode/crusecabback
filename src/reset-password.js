const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = require('./lib/prisma');

async function main() {
    const email = 'customer@example.com';
    const password = 'Customer@123';
    const name = 'Test Customer';
    const role = 'CUSTOMER'; // Adjust role based on your schema, assuming 'CUSTOMER' or 'USER'

    const user = await prisma.user.findUnique({
        where: { email },
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    if (user) {
        await prisma.user.update({
            where: { email },
            data: { password: hashedPassword },
        });
        console.log(`Password for ${email} updated to ${password}`);
    } else {
        await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role,
            },
        });
        console.log(`User ${email} created with password ${password}`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
