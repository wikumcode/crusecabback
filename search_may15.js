const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://cruise_cabs:k2aUgF8RD6RKHCZc@cruisecabdb.hbc35zf.mongodb.net/?appName=final_search";

async function run() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const admin = client.db().admin();
        const dbs = await admin.listDatabases();
        
        console.log('--- Searching ALL Databases for May 15th Data ---');
        
        const start = new Date('2026-05-15T00:00:00Z');
        const end = new Date('2026-05-16T00:00:00Z');

        for (const dbInfo of dbs.databases) {
            const db = client.db(dbInfo.name);
            const collections = await db.listCollections().toArray();
            for (const col of collections) {
                try {
                    const count = await db.collection(col.name).countDocuments({ 
                        createdAt: { $gte: start, $lt: end } 
                    });
                    if (count > 0) {
                        console.log(`Database [${dbInfo.name}] -> Collection [${col.name}] has ${count} records from May 15th.`);
                    }
                } catch (e) {
                    // Skip collections that don't support countDocuments or have schema issues
                }
            }
        }
    } finally {
        await client.close();
    }
}
run();
