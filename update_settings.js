const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateSetting() {
    try {
        await prisma.systemSetting.upsert({
            where: { key: 'website_enabled' },
            update: { value: 'true' },
            create: { key: 'website_enabled', value: 'true' }
        });
        console.log('Successfully updated website_enabled to true');
    } catch (error) {
        console.error('Error updating setting:', error);
    } finally {
        await prisma.$disconnect();
    }
}

updateSetting();
