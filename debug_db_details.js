require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const v = await prisma.vehicle.findMany({});
    console.log("Vehicles:", v.map(v => v.licensePlate));

    const c = await prisma.client.findMany({});
    console.log("Clients:", c.map(c => c.email));

    const u = await prisma.user.findMany({});
    console.log("Users:", u.map(u => ({ email: u.email, role: u.role })));
}

check();
