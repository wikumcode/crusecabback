const { MongoClient } = require('mongodb');
require('dotenv').config();

async function compareDbs() {
    const uri = process.env.DATABASE_URL.split('/cruisecabdb')[0]; // Cluster URI
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const mainDb = client.db('cruisecabdb');
        const testDb = client.db('cruisecabdb_localtest');

        const mainVehicles = await mainDb.collection('Vehicle').countDocuments();
        const testVehicles = await testDb.collection('Vehicle').countDocuments();
        
        const mainContracts = await mainDb.collection('Contract').countDocuments();
        const testContracts = await testDb.collection('Contract').countDocuments();

        console.log('--- Comparison ---');
        console.log(`Main (cruisecabdb): ${mainVehicles} vehicles, ${mainContracts} contracts`);
        console.log(`Test (localtest): ${testVehicles} vehicles, ${testContracts} contracts`);

    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

compareDbs();
