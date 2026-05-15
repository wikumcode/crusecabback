const prisma = require('../lib/prisma');
const { MongoClient } = require('mongodb');

let mongoClient = null;
let connecting = null; // Deduplicate concurrent connect calls

async function getMongoClient() {
    if (mongoClient) return mongoClient;

    // If a connection is already in-flight, wait for it instead of creating a second one
    if (connecting) return connecting;

    connecting = (async () => {
        const rawUrl = process.env.DATABASE_URL || '';
        // Strip Prisma-specific query params that the native driver doesn't understand
        const uri = rawUrl.replace(/directConnection=true&?/g, '').replace(/[?&]$/, '');

        const client = new MongoClient(uri, {
            maxPoolSize: 10,
            minPoolSize: 2,
            waitQueueTimeoutMS: 10000,
            serverSelectionTimeoutMS: 8000,
            socketTimeoutMS: 45000,
            heartbeatFrequencyMS: 10000,
            family: 4,
        });

        await client.connect();
        mongoClient = client;
        connecting = null;
        console.log('[MongoDB] Native client connected');
        return client;
    })();

    return connecting;
}

/**
 * Increments a sequence number using Prisma (Shared Connection)
 */
async function getNextSequenceValue(sequenceKey) {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: sequenceKey }
        });

        if (!setting) {
            const newSetting = await prisma.systemSetting.create({
                data: { key: sequenceKey, value: "1" }
            });
            return 1;
        }

        const nextVal = (parseInt(setting.value) || 0) + 1;
        await prisma.systemSetting.update({
            where: { key: sequenceKey },
            data: { value: nextVal.toString() }
        });

        return nextVal;
    } catch (error) {
        console.error(`[Sequence] Error incrementing ${sequenceKey}:`, error);
        // Fallback for high-concurrency (though rare in this app's current scale)
        return Math.floor(Date.now() / 1000); 
    }
}

// Pre-warm connection on module load (fire and forget)
getMongoClient().catch(err => console.warn('[MongoDB] Pre-warm connect failed:', err?.message));

module.exports = { getNextSequenceValue, getMongoClient };

