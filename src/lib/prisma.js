const { PrismaClient } = require('@prisma/client');

const prismaOptions = {
    // Only log errors in production — query/info logs add latency
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
    datasources: {
        db: { url: process.env.DATABASE_URL },
    },
};

let prisma;

if (process.env.NODE_ENV === 'production') {
    prisma = new PrismaClient(prismaOptions);
} else {
    // In development, use a global variable to preserve the connection across HMR
    if (!global.prisma) {
        global.prisma = new PrismaClient(prismaOptions);
    }
    prisma = global.prisma;
}

// Pre-warm Prisma connection so first API request doesn't pay the connect cost
prisma.$connect().catch(err => console.warn('[Prisma] Pre-warm connect failed:', err?.message));

module.exports = prisma;

