const { MongoClient } = require('mongodb');
require('dotenv').config();

async function listDatabases() {
    const uri = process.env.DATABASE_URL;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const admin = client.db().admin();
        const dbs = await admin.listDatabases();
        console.log('Databases in cluster:');
        for (const db of dbs.databases) {
            console.log(`- ${db.name} (${db.sizeOnDisk} bytes)`);
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

listDatabases();
