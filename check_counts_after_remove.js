require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const counts = {
        vehicles: await prisma.vehicle.count(),
        clients: await prisma.client.count(),
        users: await prisma.user.count(),
        bookings: await prisma.booking.count(),
        contracts: await prisma.contract.count(),
        payments: await prisma.payment.count(),
        maintenance: await prisma.maintenance.count(),
        expenses: await prisma.vehicleExpense.count(),
        odometers: await prisma.odometer.count(),
        brands: await prisma.vehicleBrand.count(),
        models: await prisma.vehicleModel.count(),
        vendors: await prisma.vendorDetails.count()
    };
    console.log("Current DB Counts:", JSON.stringify(counts, null, 2));
}

check();
