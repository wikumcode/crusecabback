const prisma = require('../lib/prisma');

// --- Brands ---
exports.getBrands = async (req, res) => {
    try {
        const brands = await prisma.vehicleBrand.findMany({ include: { models: true } });
        res.json(brands);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createBrand = async (req, res) => {
    try {
        const brand = await prisma.vehicleBrand.create({
            data: { name: req.body.name }
        });
        res.status(201).json(brand);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateBrand = async (req, res) => {
    try {
        const { id } = req.params;
        const brand = await prisma.vehicleBrand.update({
            where: { id },
            data: { name: req.body.name }
        });
        res.json(brand);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteBrand = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.vehicleBrand.delete({ where: { id } });
        res.json({ message: 'Brand deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Models ---
exports.getModels = async (req, res) => {
    try {
        const { brandId } = req.query;
        const where = brandId ? { brandId } : {};
        const models = await prisma.vehicleModel.findMany({
            where,
            include: { brand: true }
        });
        res.json(models);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createModel = async (req, res) => {
    try {
        const { name, brandId } = req.body;
        const model = await prisma.vehicleModel.create({
            data: { name, brandId }
        });
        res.status(201).json(model);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateModel = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, brandId } = req.body;
        const model = await prisma.vehicleModel.update({
            where: { id },
            data: { name, brandId }
        });
        res.json(model);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteModel = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.vehicleModel.delete({ where: { id } });
        res.json({ message: 'Model deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Categories ---
exports.getCategories = async (req, res) => {
    try {
        const categories = await prisma.fleetCategory.findMany({
            orderBy: { sortOrder: 'asc' }
        });
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { name, sortOrder } = req.body;
        const category = await prisma.fleetCategory.create({
            data: { 
                name, 
                sortOrder: parseInt(sortOrder) || 0 
            }
        });
        res.status(201).json(category);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, sortOrder } = req.body;
        const category = await prisma.fleetCategory.update({
            where: { id },
            data: { 
                name, 
                sortOrder: parseInt(sortOrder) || 0 
            }
        });
        res.json(category);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.fleetCategory.delete({ where: { id } });
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
