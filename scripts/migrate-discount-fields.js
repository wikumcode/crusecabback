/**
 * Adds discount columns to Contract and Quotation (PostgreSQL).
 * Run once on live after deploying the discount feature backend.
 *
 *   node scripts/migrate-discount-fields.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const STATEMENTS = [
    `ALTER TABLE "Contract"
      ADD COLUMN IF NOT EXISTS "base_daily_rate" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "discount_type" TEXT,
      ADD COLUMN IF NOT EXISTS "discount_value" DOUBLE PRECISION`,
    `ALTER TABLE "Quotation"
      ADD COLUMN IF NOT EXISTS "base_daily_rate" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "discount_type" TEXT,
      ADD COLUMN IF NOT EXISTS "discount_value" DOUBLE PRECISION`,
];

async function main() {
    for (const sql of STATEMENTS) {
        await prisma.$executeRawUnsafe(sql);
        console.log('OK:', sql.split('\n')[0].trim(), '...');
    }
    console.log('\nDiscount columns are ready. Restart the API after: npx prisma generate');
}

main()
    .catch((err) => {
        console.error('Migration failed:', err.message);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
