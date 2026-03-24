const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function fix() {
    try {
        const email = 'superadmin@codebraze.lk';
        const password = 'SuperAdmin@codebraze';
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.upsert({
            where: { email },
            update: {
                password: hashedPassword,
                role: 'SUPER_ADMIN'
            },
            create: {
                email,
                password: hashedPassword,
                name: 'Super Admin',
                role: 'SUPER_ADMIN'
            }
        });
        console.log('Superadmin updated/created successfully:', user.email);
    } catch (error) {
        console.error('Error fixing superadmin:', error);
    } finally {
        await prisma.$disconnect();
    }
}

fix();
