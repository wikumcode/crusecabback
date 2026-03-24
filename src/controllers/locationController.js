const prisma = require('../lib/prisma');

// Districts
exports.getDistricts = async (req, res) => {
    try {
        const districts = await prisma.district.findMany({
            include: { cities: true }
        });
        res.json(districts);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch districts' });
    }
};

exports.createDistrict = async (req, res) => {
    try {
        const { name } = req.body;
        const district = await prisma.district.create({
            data: { name }
        });
        res.status(201).json(district);
    } catch (error) {
        res.status(400).json({ message: 'Failed to create district' });
    }
};

// Cities
exports.getCities = async (req, res) => {
    try {
        const { districtId } = req.query;
        const where = districtId ? { districtId } : {};
        const cities = await prisma.city.findMany({
            where,
            include: { district: true }
        });
        res.json(cities);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch cities' });
    }
};

exports.createCity = async (req, res) => {
    try {
        const { name, districtId } = req.body;
        const city = await prisma.city.create({
            data: { name, districtId }
        });
        res.status(201).json(city);
    } catch (error) {
        res.status(400).json({ message: 'Failed to create city' });
    }
};
