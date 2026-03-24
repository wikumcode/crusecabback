const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function verify() {
    try {
        const user = await prisma.user.findUnique({
            where: { email: 'superadmin@codebraze.lk' }
        });
        if (user) {
            const isMatch = await bcrypt.compare('SuperAdmin@codebraze', user.password);
            console.log('Password Match:', isMatch);
            console.log('User Role:', user.role);
        } else {
            console.log('Superadmin NOT found.');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

verify();
