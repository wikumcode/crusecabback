const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function resetPassword() {
    try {
        const password = 'Prasanna1234';
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.update({
            where: { email: 'prasanna@gmail.com' },
            data: { password: hashedPassword }
        });

        console.log('Password reset successful for:', user.email);
        console.log('New Hash:', hashedPassword);
    } catch (error) {
        console.error('Error resetting password:', error);
    } finally {
        await prisma.$disconnect();
    }
}

resetPassword();
