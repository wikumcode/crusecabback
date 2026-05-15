const prisma = require('../lib/prisma');

// --- Brands ---
exports.getBrands = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const skip = (page - 1) * limit;

        const [brands, totalCount] = await Promise.all([
            prisma.vehicleBrand.findMany({
                include: { models: true },
                skip,
                take: limit,
                orderBy: { name: 'asc' }
            }),
            prisma.vehicleBrand.count()
        ]);

        res.json({
            data: brands,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const skip = (page - 1) * limit;

        const where = brandId ? { brandId } : {};
        
        const [models, totalCount] = await Promise.all([
            prisma.vehicleModel.findMany({
                where,
                include: { brand: true },
                skip,
                take: limit,
                orderBy: { name: 'asc' }
            }),
            prisma.vehicleModel.count({ where })
        ]);

        res.json({
            data: models,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const skip = (page - 1) * limit;

        const [categories, totalCount] = await Promise.all([
            prisma.fleetCategory.findMany({
                orderBy: { sortOrder: 'asc' },
                skip,
                take: limit
            }),
            prisma.fleetCategory.count()
        ]);

        res.json({
            data: categories,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { name, sortOrder } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Category name is required' });
        }
        const category = await prisma.fleetCategory.create({
            data: { 
                name: name.trim(), 
                sortOrder: parseInt(sortOrder, 10) || 0 
            }
        });
        res.status(201).json(category);
    } catch (error) {
        console.error('[FleetController] Failed to create category:', error);
        res.status(500).json({ error: error.message || 'Internal server error while creating category' });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, sortOrder } = req.body;
        const category = await prisma.fleetCategory.update({
            where: { id },
            data: { 
                name: name?.trim(), 
                sortOrder: parseInt(sortOrder, 10) || 0 
            }
        });
        res.json(category);
    } catch (error) {
        console.error(`[FleetController] Failed to update category ${req.params.id}:`, error);
        res.status(500).json({ error: error.message || 'Internal server error while updating category' });
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
