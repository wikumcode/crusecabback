/**
 * Legacy MongoDB index helper. Indexes for PostgreSQL are defined in `prisma/schema.prisma`.
 */
async function createIndexes() {
    console.log('[createIndexes] Skipped (PostgreSQL — use prisma migrate).');
}

module.exports = { createIndexes };
