const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://cruise_cabs:k2aUgF8RD6RKHCZc@cruisecabdb.hbc35zf.mongodb.net/?appName=recovery";
const SOURCE_DB = "cruisecabdb_localtest";
const TARGET_DB = "cruisecabdb";

async function recover() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log(`--- Starting Data Recovery ---`);
        console.log(`Source: ${SOURCE_DB}`);
        console.log(`Target: ${TARGET_DB}`);

        const source = client.db(SOURCE_DB);
        const target = client.db(TARGET_DB);

        // Get all collections from source
        const collections = await source.listCollections().toArray();
        
        for (const col of collections) {
            const colName = col.name;
            if (colName.startsWith('system.')) continue; // Skip internal collections

            console.log(`\nRecovering collection: ${colName}...`);
            
            // 1. Get data from source
            const data = await source.collection(colName).find({}).toArray();
            console.log(` - Found ${data.length} records in source.`);

            if (data.length > 0) {
                // 2. Clear target
                await target.collection(colName).deleteMany({});
                console.log(` - Cleared target collection.`);

                // 3. Insert into target
                await target.collection(colName).insertMany(data);
                console.log(` - Successfully copied ${data.length} records to target.`);
            } else {
                console.log(` - Skipping (no data found).`);
            }
        }

        console.log(`\n--- RECOVERY COMPLETE ---`);
        console.log(`Your main database (${TARGET_DB}) now contains all data from ${SOURCE_DB}.`);

    } catch (err) {
        console.error("Recovery failed:", err);
    } finally {
        await client.close();
    }
}

recover();
