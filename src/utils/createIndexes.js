const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function createIndexes() {
    const uri = process.env.DATABASE_URL.split('?')[0]; // Remove Prisma query params
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB for indexing...');
        
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = client.db(dbName);

        // --- CLEANUP CORRUPTED DATA ---
        console.log('--- DEEP CLEANUP START ---');
        
        console.log('1. Removing "NaN" corrupted records...');
        await db.collection('Invoice').deleteMany({ invoiceNo: /NaN/ });
        await db.collection('Contract').deleteMany({ contractNo: /NaN/ });
        await db.collection('Agreement').deleteMany({ agreementNo: /NaN/ });

        console.log('2. Removing orphaned LedgerEntries (no parent invoice)...');
        // Any ledger entry that doesn't have a valid invoiceId link
        await db.collection('LedgerEntry').deleteMany({ invoiceId: { $exists: false } });

        console.log('3. Normalizing empty fields to NULL for unique indexing...');
        // Unique indexes fail if multiple records have "" (empty string). We change them to NULL.
        await db.collection('Vehicle').updateMany({ licensePlate: "" }, { $set: { licensePlate: null } });
        await db.collection('Contract').updateMany({ contractNo: "" }, { $set: { contractNo: null } });
        await db.collection('Invoice').updateMany({ invoiceNo: "" }, { $set: { invoiceNo: null } });

        const safeIndex = async (collName, spec, options = {}) => {
            try {
                const optStr = options.unique ? ' [UNIQUE]' : '';
                console.log(`Indexing ${collName} ${JSON.stringify(spec)}${optStr}...`);
                await db.collection(collName).createIndex(spec, options);
            } catch (e) {
                if (e.code === 11000) {
                    console.warn(`❌ UNIQUE CONSTRAINT FAILURE: ${collName} has duplicate data for ${JSON.stringify(spec)}. Cleanup required.`);
                } else {
                    console.warn(`⚠️  Could not index ${collName}: ${e.message}`);
                }
            }
        };

        // --- CONTRACTS ---
        await safeIndex('Contract', { pickupDate: -1 });
        await safeIndex('Contract', { status: 1 });
        await safeIndex('Contract', { contractNo: 1 }, { unique: true, sparse: true });
        await safeIndex('Contract', { customerId: 1 });

        // --- INVOICES ---
        await safeIndex('Invoice', { invoiceNo: 1 }, { unique: true, sparse: true });
        await safeIndex('Invoice', { type: 1 });
        await safeIndex('Invoice', { status: 1 });
        await safeIndex('Invoice', { createdAt: -1 });

        // --- AGREEMENTS ---
        await safeIndex('Agreement', { agreementNo: 1 }, { unique: true, sparse: true });
        await safeIndex('Agreement', { contractId: 1 });

        // --- LEDGER ENTRIES ---
        await safeIndex('LedgerEntry', { invoiceId: 1 });
        await safeIndex('LedgerEntry', { type: 1 });
        await safeIndex('LedgerEntry', { createdAt: -1 });

        // --- VEHICLES ---
        await safeIndex('Vehicle', { licensePlate: 1 }, { unique: true, sparse: true });
        await safeIndex('Vehicle', { status: 1 });

        // --- CLIENTS ---
        await safeIndex('Client', { phone: 1 });
        await safeIndex('Client', { email: 1 });

        console.log('✅ DEEP CLEANUP & STRATEGIC INDEXING COMPLETED');


    } catch (err) {
        console.error('❌ Indexing failed:', err);
    } finally {
        await client.close();
    }
}

createIndexes();
