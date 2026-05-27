const prisma = require('../lib/prisma');

/**
 * Increments a sequence number using Prisma (SystemSetting key/value).
 */
async function getNextSequenceValue(sequenceKey) {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: sequenceKey },
        });

        if (!setting) {
            await prisma.systemSetting.create({
                data: { key: sequenceKey, value: '1' },
            });
            return 1;
        }

        const nextVal = (parseInt(setting.value, 10) || 0) + 1;
        await prisma.systemSetting.update({
            where: { key: sequenceKey },
            data: { value: String(nextVal) },
        });

        return nextVal;
    } catch (error) {
        console.error(`[Sequence] Error incrementing ${sequenceKey}:`, error);
        return Math.floor(Date.now() / 1000);
    }
}

module.exports = { getNextSequenceValue };
