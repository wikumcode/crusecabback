
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanUp() {
    const email = 'final@driver.com';
    console.log(`Checking for user with email: ${email}`);

    const user = await prisma.user.findUnique({
        where: { email },
        include: { driverDetails: true }
    });

    if (user) {
        console.log('User found:', user.id);
        if (!user.driverDetails) {
            console.log('User has no driver details (Zombie record). Deleting...');
            await prisma.user.delete({ where: { id: user.id } });
            console.log('User deleted.');
        } else {
            console.log('User already has driver details. It looks like it was created?');
            console.log(user.driverDetails);
            // If it exists but we want to re-test, we should probably delete it.
            console.log('Deleting existing complete driver to allow re-test...');
            await prisma.driverDetails.delete({ where: { userId: user.id } }); // Delete details first if cascade not set
            await prisma.user.delete({ where: { id: user.id } });
            console.log('Full driver record deleted.');
        }
    } else {
        console.log('User not found. Safe to create.');
    }
}

cleanUp()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
