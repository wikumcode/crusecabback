const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const email = 'superadmin@codebraze.lk';
    const password = 'SuperAdmin@codebraze';
    const name = 'Super Admin';
    const role = 'ADMIN';

    const existingUser = await prisma.user.findUnique({
        where: { email },
    });

    if (existingUser) {
        console.log(`User with email ${email} already exists. Updating role to ${role}.`);
        await prisma.user.update({
            where: { email },
            data: { role, password: await bcrypt.hash(password, 10) } // Ensure password is also correct
        });
    } else {
        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role,
            },
        });
        console.log(`User ${email} created with role ${role}.`);
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
