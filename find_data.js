const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://cruise_cabs:k2aUgF8RD6RKHCZc@cruisecabdb.hbc35zf.mongodb.net/?appName=cruisecabdb";

async function findMyData() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log("--- Connected to MongoDB Cluster ---");
        
        const admin = client.db().admin();
        const dbs = await admin.listDatabases();
        
        console.log("\nAvailable Databases:");
        for (const dbInfo of dbs.databases) {
            const dbName = dbInfo.name;
            if (['admin', 'local', 'config'].includes(dbName)) continue;
            
            const db = client.db(dbName);
            const collections = await db.listCollections().toArray();
            const userCount = await db.collection('User').countDocuments().catch(() => 0);
            const vehicleCount = await db.collection('Vehicle').countDocuments().catch(() => 0);
            
            console.log(`\n[Database: ${dbName}]`);
            console.log(`- Size: ${Math.round(dbInfo.sizeOnDisk / 1024 / 1024)} MB`);
            console.log(`- Collections: ${collections.map(c => c.name).join(', ')}`);
            console.log(`- User Count: ${userCount}`);
            console.log(`- Vehicle Count: ${vehicleCount}`);
            
            if (userCount > 0) {
                const sampleUser = await db.collection('User').findOne({}, { projection: { email: 1 } });
                console.log(`- Sample User Email: ${sampleUser?.email}`);
            }
        }
        
    } catch (err) {
        console.error("Error connecting to MongoDB:", err);
    } finally {
        await client.close();
    }
}

findMyData();
