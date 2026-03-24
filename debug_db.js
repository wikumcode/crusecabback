const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log("Attempting to connect to database...");
        const count = await prisma.vehicle.count();
        console.log(`Successfully connected. Vehicle count: ${count}`);

        if (count > 0) {
            const vehicles = await prisma.vehicle.findMany({ take: 3 });
            console.log("Sample vehicles:", JSON.stringify(vehicles, null, 2));
        } else {
            console.log("Database is connected but empty of vehicles.");
        }

        // Check Odometer table existence by counting
        try {
            const odoCount = await prisma.odometer.count();
            console.log(`Odometer table exists. Count: ${odoCount}`);
        } catch (e) {
            console.error("Error accessing Odometer table (Migration might be missing):", e.message);
        }

    } catch (e) {
        console.error("Database Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
