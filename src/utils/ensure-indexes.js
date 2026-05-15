const { getMongoClient } = require('./sequence');

/**
 * Ensures critical performance indexes are present in the MongoDB database.
 * This is vital for maintaining speed as the system grows.
 */
async function ensureIndexes() {
    try {
        const client = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = client.db(dbName);

        console.log(`[Performance] Checking indexes for DB: ${dbName}...`);

        // 1. Contract Indexes (Dashboard & Calendar speed)
        await db.collection('Contract').createIndex({ status: 1 });
        await db.collection('Contract').createIndex({ pickupDate: 1, dropoffDate: 1 });
        await db.collection('Contract').createIndex({ customerId: 1 });
        await db.collection('Contract').createIndex({ vehicleId: 1 });

        // 2. Vehicle Indexes (Fleet status counts)
        await db.collection('Vehicle').createIndex({ status: 1 });
        await db.collection('Vehicle').createIndex({ licensePlate: 1 });

        // 3. Client Indexes (Search speed)
        await db.collection('Client').createIndex({ phone: 1 });
        await db.collection('Client').createIndex({ nicOrPassport: 1 });
        await db.collection('Client').createIndex({ name: 'text', phone: 'text' });

        // 4. Invoice Indexes (Financial reporting)
        await db.collection('Invoice').createIndex({ createdAt: -1 });
        await db.collection('Invoice').createIndex({ status: 1 });
        await db.collection('Invoice').createIndex({ contractId: 1 });

        console.log('[Performance] Critical indexes verified and ensured.');
    } catch (error) {
        console.error('[Performance] Index bootstrap failed:', error.message);
    }
}

module.exports = { ensureIndexes };
