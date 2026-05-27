const { MongoClient, ObjectId } = require('mongodb');

const uri = "mongodb+srv://cruise_cabs:k2aUgF8RD6RKHCZc@cruisecabdb.hbc35zf.mongodb.net/?appName=final_search";

async function run() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const admin = client.db().admin();
        const dbs = await admin.listDatabases();
        
        console.log('--- Searching ALL Databases for May 15th (By ID Timestamp) ---');
        
        // Start and end timestamps for May 15th 2026
        const start = Math.floor(new Date('2026-05-15T00:00:00Z').getTime() / 1000);
        const end = Math.floor(new Date('2026-05-16T00:00:00Z').getTime() / 1000);

        for (const dbInfo of dbs.databases) {
            const db = client.db(dbInfo.name);
            const collections = await db.listCollections().toArray();
            for (const col of collections) {
                try {
                    const allDocs = await db.collection(col.name).find({}, { projection: { _id: 1 } }).toArray();
                    let count = 0;
                    for (const doc of allDocs) {
                        const ts = parseInt(doc._id.toString().substring(0, 8), 16);
                        if (ts >= start && ts < end) {
                            count++;
                        }
                    }
                    if (count > 0) {
                        console.log(`Database [${dbInfo.name}] -> Collection [${col.name}] has ${count} records created on May 15th.`);
                    }
                } catch (e) { }
            }
        }
    } finally {
        await client.close();
    }
}
run();
