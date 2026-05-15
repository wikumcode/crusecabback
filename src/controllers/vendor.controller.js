const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

// Get all vendors (Role = VENDOR)
exports.getVendors = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
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

const { getNextSequenceValue, getMongoClient } = require('../utils/sequence');
const { ObjectId } = require('mongodb');

const generateVendorCode = async () => {
    // Generate Code: VEN/00001 via SystemSetting sequence
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

        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        // 1. Create User
        const userData = {
            email,
            password: hashedPassword,
            name,
            role: 'VENDOR',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const userResult = await db.collection('User').insertOne(userData);
        const userId = userResult.insertedId;

        // 2. Create VendorDetails
        const vendorDetailsData = {
            userId: userId,
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
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await db.collection('VendorDetails').insertOne(vendorDetailsData);

        res.status(201).json({ 
            message: 'Vendor created successfully', 
            vendor: { id: userId, ...userData } 
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

        const userData = { name, email, updatedAt: new Date() };
        if (password) {
            userData.password = await bcrypt.hash(password, 10);
        }

        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        // 1. Update User
        await db.collection('User').updateOne(
            { _id: new ObjectId(id) },
            { $set: userData }
        );

        // 2. Upsert VendorDetails
        const vendorDetailsData = {
            phone, address, nic,
            nicFrontUrl, nicBackUrl, utilityBillUrl, attachment1Url, attachment2Url,
            vendorType, photoUrl,
            updatedAt: new Date()
        };

        await db.collection('VendorDetails').updateOne(
            { userId: new ObjectId(id) },
            { 
                $set: vendorDetailsData,
                $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true }
        );

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
        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        // Delete VendorDetails first
        await db.collection('VendorDetails').deleteOne({ userId: new ObjectId(id) });
        // Then delete User
        await db.collection('User').deleteOne({ _id: new ObjectId(id) });

        res.json({ message: "Vendor deleted successfully" });
    } catch (error) {
        console.error("Delete Vendor Error:", error);
        res.status(500).json({ message: "Failed to delete vendor" });
    }
};
