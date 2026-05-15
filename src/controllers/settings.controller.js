const prisma = require('../lib/prisma');

// Get setting request
exports.getSetting = async (req, res) => {
    try {
        const { key } = req.params;
        const setting = await prisma.systemSetting.findUnique({
            where: { key }
        });
        // Default to false if not found for website enable
        res.json({ value: setting ? setting.value : 'false' });
    } catch (error) {
        console.error("Get Setting Error:", error);
        res.status(500).json({ message: "Failed to fetch setting" });
    }
};

const { MongoClient } = require('mongodb');

// Update setting request
exports.updateSetting = async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        // Use Native Driver to bypass Replica Set requirement
        const client = new MongoClient(process.env.DATABASE_URL);
        await client.connect();
        const db = client.db(); // Uses db from connection string
        
        const result = await db.collection('SystemSetting').updateOne(
            { key },
            { $set: { value: String(value), updatedAt: new Date() } },
            { upsert: true }
        );

        await client.close();
        res.json({ key, value });
    } catch (error) {
        console.error("Update Setting Error:", error);
        res.status(500).json({ message: "Failed to update setting" });
    }
};
// Get multiple settings at once
exports.getSettingsBulk = async (req, res) => {
    try {
        const { keys } = req.query; // Expecting comma-separated keys or multiple keys
        if (!keys) return res.json({});

        const keysArray = String(keys).split(',');
        const settings = await prisma.systemSetting.findMany({
            where: {
                key: { in: keysArray }
            }
        });

        // Convert array to key-value object
        const result = {};
        keysArray.forEach(k => {
            const match = settings.find(s => s.key === k);
            result[k] = match ? match.value : 'false';
        });

        res.json(result);
    } catch (error) {
        console.error("Get Settings Bulk Error:", error);
        res.status(500).json({ message: "Failed to fetch settings" });
    }
};
