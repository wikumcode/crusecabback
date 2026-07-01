/**
 * First-time local DB for Cruise Cabs only (not other Rentix clients).
 * Creates schema in cruisecabs_local + discount columns + admin user seed.
 *
 *   node scripts/setup-cruisecabs-local-db.js
 */
require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

const backDir = path.join(__dirname, '..');

function run(cmd) {
    console.log('>', cmd);
    execSync(cmd, { cwd: backDir, stdio: 'inherit', shell: true });
}

async function main() {
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('cruisecabs_local')) {
        console.warn('Warning: DATABASE_URL does not point at cruisecabs_local.');
        console.warn('Current:', url.replace(/:([^@]+)@/, ':****@'));
    }
    run('npx prisma db push');
    run('npm run migrate:discount-fields');
    run('npm run migrate:quotation-contact-km');
    run('npx prisma db seed');
    console.log('\nCruise Cabs local database is ready.');
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
