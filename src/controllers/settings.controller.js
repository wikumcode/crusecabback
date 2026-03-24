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

// Update setting request
exports.updateSetting = async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        const setting = await prisma.systemSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) }
        });

        res.json(setting);
    } catch (error) {
        console.error("Update Setting Error:", error);
        res.status(500).json({ message: "Failed to update setting" });
    }
};
