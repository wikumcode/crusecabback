const { MongoClient } = require('mongodb');
require('dotenv').config();

async function listCollections() {
    const uri = process.env.DATABASE_URL;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db();
        const collections = await db.listCollections().toArray();
        console.log('Collections in database:');
        for (const col of collections) {
            const count = await db.collection(col.name).countDocuments();
            console.log(`- ${col.name}: ${count} documents`);
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

listCollections();
