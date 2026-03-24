require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { removeDemoData } = require('./src/controllers/system.controller');

const req = {};
const res = {
    json: (data) => console.log("SUCCESS:", JSON.stringify(data, null, 2)),
    status: (code) => {
        console.log("STATUS:", code);
        return {
            json: (data) => console.error("ERROR:", JSON.stringify(data, null, 2))
        };
    }
};

async function test() {
    console.log("Running remove demo data...");
    try {
        await removeDemoData(req, res);
    } catch (e) {
        console.error("CAUGHT ERROR:", e);
    }
}

test();
