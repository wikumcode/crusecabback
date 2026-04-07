const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

// Get all vendors (Role = VENDOR)
exports.getVendors = async (req, res) => {
    try {
        const vendors = await prisma.user.findMany({
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
            }
        });
        res.json(vendors);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch vendors' });
    }
};

const generateVendorCode = async () => {
    // Generate Code: VEN/00001 via SystemSetting sequence
    const sequenceRecord = await prisma.$transaction(async (tx) => {
        let record = await tx.systemSetting.findUnique({ where: { key: 'vendor_sequence' } });
        if (!record) {
            return await tx.systemSetting.create({ data: { key: 'vendor_sequence', value: '1' } });
        } else {
            const nextVal = parseInt(record.value) + 1;
            return await tx.systemSetting.update({
                where: { key: 'vendor_sequence' },
                data: { value: nextVal.toString() }
            });
        }
    });

    const nextNumber = parseInt(sequenceRecord.value);
    return `VEN/${String(nextNumber).padStart(5, '0')}`;
};

// Create a new vendor
exports.createVendor = async (req, res) => {
    try {
        const {
            email, name,
            phone, address, nic,
            nicFrontUrl, nicBackUrl, utilityBillUrl, attachment1Url, attachment2Url,
            vendorType, photoUrl // Accept photoUrl
        } = req.body;

        let { password } = req.body;

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });

        // Generate random password if not provided
        if (!password) {
            password = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const vendorCode = await generateVendorCode(); // Auto-generate code

        const result = await prisma.$transaction(async (prisma) => {
            const user = await prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    name,
                    role: 'VENDOR'
                }
            });

            const vendorDetails = await prisma.vendorDetails.create({
                data: {
                    userId: user.id,
                    vendorCode, // Save code
                    photoUrl,   // Save photo
                    phone,
                    address,
                    nic,
                    nicFrontUrl,
                    nicBackUrl,
                    utilityBillUrl,
                    attachment1Url,
                    attachment2Url,
                    vendorType
                }
            });

            return { user, vendorDetails };
        });

        res.status(201).json({ message: 'Vendor created successfully', vendor: result.user });
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
            vendorType, photoUrl // Accept photoUrl
        } = req.body;

        const data = { name, email };
        if (password) {
            data.password = await bcrypt.hash(password, 10);
        }

        // Update User and VendorDetails in parallel or separate queries (transactional is safer)
        const vendor = await prisma.user.update({
            where: { id },
            data: {
                ...data,
                vendorDetails: {
                    upsert: {
                        create: {
                            phone, address, nic,
                            nicFrontUrl, nicBackUrl, utilityBillUrl, attachment1Url, attachment2Url,
                            vendorType, photoUrl // Save photo on create fallback
                        },
                        update: {
                            phone, address, nic,
                            nicFrontUrl, nicBackUrl, utilityBillUrl, attachment1Url, attachment2Url,
                            vendorType, photoUrl // Save photo on update
                        }
                    }
                }
            },
            include: { vendorDetails: true }
        });

        res.json({ message: 'Vendor updated successfully', vendor });
    } catch (error) {
        console.error("Update Vendor Error:", error);
        res.status(400).json({ message: error.message || 'Failed to update vendor' });
    }
};

// Delete vendor
exports.deleteVendor = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.user.delete({ where: { id } });
        res.json({ message: 'Vendor deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete vendor' });
    }
};
