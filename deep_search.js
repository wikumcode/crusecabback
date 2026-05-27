const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://cruise_cabs:k2aUgF8RD6RKHCZc@cruisecabdb.hbc35zf.mongodb.net/cruisecabdb";

async function deepSearch() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        
        console.log("--- Deep Search in cruisecabdb ---");
        
        // 1. Find users created before today
        const cutoff = new Date('2026-05-16T00:00:00Z');
        const oldUsers = await db.collection('User').find({ createdAt: { $lt: cutoff } }).toArray();
        console.log(`\nUsers created BEFORE today: ${oldUsers.length}`);
        oldUsers.forEach(u => console.log(` - ${u.email} (${u.name}) | Role: ${u.role}`));

        // 2. Find vehicles created before today
        const oldVehicles = await db.collection('Vehicle').find({ createdAt: { $lt: cutoff } }).toArray();
        console.log(`\nVehicles created BEFORE today: ${oldVehicles.length}`);
        oldVehicles.forEach(v => console.log(` - ${v.licensePlate} (${v.color} ${v.year})`));

        // 3. Find ANY other collections that might have data
        console.log(`\nChecking all collections for record counts:`);
        const collections = await db.listCollections().toArray();
        for (const col of collections) {
            const count = await db.collection(col.name).countDocuments();
            if (count > 0) {
                console.log(` - ${col.name}: ${count} records`);
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

deepSearch();
