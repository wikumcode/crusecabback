const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log("--- DEBUG START ---");
        // Check if odometer property exists on prisma instance
        if (prisma.odometer) {
            console.log("Prisma Client HAS Odometer model.");
        } else {
            console.log("Prisma Client MISSING Odometer model (Need prisma generate).");
        }

        try {
            const vehicles = await prisma.vehicle.findMany({ take: 1 });
            console.log(`Vehicles query successful. Found: ${vehicles.length}`);
        } catch (e) {
            console.log("Vehicles query FAILED: " + e.message);
        }
        console.log("--- DEBUG END ---");
    } catch (e) {
        console.error("Global Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
