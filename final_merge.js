const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');

const uri = "mongodb+srv://cruise_cabs:k2aUgF8RD6RKHCZc@cruisecabdb.hbc35zf.mongodb.net/?appName=final_merge";

async function mergeAll() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const mainDb = client.db('cruisecabdb');
        const testDb = client.db('cruisecabdb_localtest');

        console.log("--- Final Data Merge & Restoration ---");

        // 1. Cleanup Demo Vehicles from main
        console.log("Cleaning up demo vehicles...");
        await mainDb.collection('Vehicle').deleteMany({
            licensePlate: { $regex: /^WP [A-Z]{2} \d{4}$/ } // Matches the demo pattern like 'WP BC 1001'
        });

        // 2. Copy Vehicles from LocalTest to Main
        console.log("Copying real vehicles from localtest...");
        const testVehicles = await testDb.collection('Vehicle').find({}).toArray();
        if (testVehicles.length > 0) {
            for (const v of testVehicles) {
                await mainDb.collection('Vehicle').updateOne(
                    { _id: v._id },
                    { $set: v },
                    { upsave: true, upsert: true }
                );
            }
            console.log(` - Merged ${testVehicles.length} vehicles from localtest.`);
        }

        // 3. Import from vehicles.json (Local)
        console.log("Importing vehicles from vehicles.json...");
        try {
            const content = fs.readFileSync('vehicles.json');
            // Handle UTF-16 with BOM if present
            const jsonStr = content.toString('utf16le').replace(/^\uFEFF/, '');
            const localVehicles = JSON.parse(jsonStr);
            
            for (const v of localVehicles) {
                // Convert string ID to ObjectId if necessary
                const vId = typeof v.id === 'string' ? new ObjectId(v.id) : v.id;
                delete v.id; // Remove the 'id' field to avoid duplicate key error with '_id'
                
                await mainDb.collection('Vehicle').updateOne(
                    { _id: vId },
                    { $set: { ...v, _id: vId } },
                    { upsert: true }
                );
            }
            console.log(` - Merged ${localVehicles.length} vehicles from vehicles.json.`);
        } catch (err) {
            console.error(" - Error reading vehicles.json:", err.message);
        }

        console.log("\n--- MERGE COMPLETE ---");
        console.log("Your main database (cruisecabdb) is now restored.");

    } catch (err) {
        console.error("Merge failed:", err);
    } finally {
        await client.close();
    }
}

mergeAll();
