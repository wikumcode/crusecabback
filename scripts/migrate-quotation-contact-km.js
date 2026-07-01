/**
 * Adds customer contact + mileage columns to Quotation (PostgreSQL).
 *
 *   node scripts/migrate-quotation-contact-km.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const SQL = `ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "customer_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_address" TEXT,
  ADD COLUMN IF NOT EXISTS "daily_allocated_km" INTEGER,
  ADD COLUMN IF NOT EXISTS "extra_km_charge" DOUBLE PRECISION`;

async function main() {
    await prisma.$executeRawUnsafe(SQL);
    console.log('OK: Quotation contact + mileage columns ready.');
    console.log('Restart the API after: npx prisma generate');
}

main()
    .catch((err) => {
        console.error('Migration failed:', err.message);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
