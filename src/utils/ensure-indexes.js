/**
 * Critical indexes are declared on models in `prisma/schema.prisma` (@@index).
 * MongoDB used a runtime bootstrap here; PostgreSQL relies on migrations instead.
 */
async function ensureIndexes() {
    console.log('[Performance] Index bootstrap skipped (PostgreSQL — use prisma migrate).');
}

module.exports = { ensureIndexes };
