const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

// Get all vendors (Role = VENDOR)
exports.getVendors = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const [vendors, totalCount] = await Promise.all([
            prisma.user.findMany({
                where: { role: 'VENDOR' },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    createdAt: true,
                    vendorDetails: true,
                    vendorVehicles: {
                        include: {
                            vehicleModel: {
                                include: {
                                    brand: true
                                }
                            }
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.user.count({ where: { role: 'VENDOR' } })
        ]);

        res.json({
            data: vendors,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch vendors' });
    }
};

const { getNextSequenceValue } = require('../utils/sequence');

const generateVendorCode = async () => {
    const nextNumber = await getNextSequenceValue('vendor_sequence');
    return `VEN/${String(nextNumber).padStart(5, '0')}`;
};

// Create a new vendor
exports.createVendor = async (req, res) => {
    try {
        const {
            email, name,
            phone, address, nic,
            nicFrontUrl, nicBackUrl, utilityBillUrl, attachment1Url, attachment2Url,
            vendorType, photoUrl
        } = req.body;

        let { password } = req.body;

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });

        if (!password) {
            password = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const vendorCode = await generateVendorCode();

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role: 'VENDOR',
                vendorDetails: {
                    create: {
                        vendorCode,
                        photoUrl,
                        phone,
                        address,
                        nic,
                        nicFrontUrl,
                        nicBackUrl,
                        utilityBillUrl,
                        attachment1Url,
                        attachment2Url,
                        vendorType,
                    },
                },
            },
        });

        res.status(201).json({
            message: 'Vendor created successfully',
            vendor: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
        });
    } catch (error) {
        console.error("Create Vendor Error:", error);
        res.status(400).json({ message: error.message || 'Failed to create vendor' });
    }
};

// Update vendor
exports.updateVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, email, password,
            phone, address, nic,
            nicFrontUrl, nicBackUrl, utilityBillUrl, attachment1Url, attachment2Url,
            vendorType, photoUrl
        } = req.body;

        const userData = { name, email };
        if (password) {
            userData.password = await bcrypt.hash(password, 10);
        }

        await prisma.user.update({
            where: { id },
            data: userData,
        });

        await prisma.vendorDetails.upsert({
            where: { userId: id },
            create: {
                userId: id,
                phone,
                address,
                nic,
                nicFrontUrl,
                nicBackUrl,
                utilityBillUrl,
                attachment1Url,
                attachment2Url,
                vendorType,
                photoUrl,
            },
            update: {
                phone,
                address,
                nic,
                nicFrontUrl,
                nicBackUrl,
                utilityBillUrl,
                attachment1Url,
                attachment2Url,
                vendorType,
                photoUrl,
            },
        });

        res.json({ message: 'Vendor updated successfully' });
    } catch (error) {
        console.error("Update Vendor Error:", error);
        res.status(500).json({ message: "Failed to update vendor" });
    }
};

// Delete vendor
exports.deleteVendor = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.vendorDetails.deleteMany({ where: { userId: id } });
        await prisma.user.delete({ where: { id } });
        res.json({ message: "Vendor deleted successfully" });
    } catch (error) {
        console.error("Delete Vendor Error:", error);
        res.status(500).json({ message: "Failed to delete vendor" });
    }
};
