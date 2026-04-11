const prisma = require('../lib/prisma');
const { sendWelcomeEmail } = require('../utils/email');

// Create new customer
exports.createClient = async (req, res) => {
    try {
        const {
            type, status, email, phone, mobile, address,
            name, nicOrPassport, passportNo, drivingLicenseNo,
            companyName, brNumber, contactPersonName, contactPersonMobile,
            closeRelationName, closeRelationMobile,
            intlDrivingLicenseFrontUrl, intlDrivingLicenseBackUrl, aaPermitUrl,
            doc1Url, doc2Url, utilityBillUrl, support1Url, support2Url,
            drivingLicenseFrontUrl, drivingLicenseBackUrl
        } = req.body;

        // Generate Code: CUS/00001 via SystemSetting sequence
        const sequenceRecord = await prisma.$transaction(async (tx) => {
            let record = await tx.systemSetting.findUnique({ where: { key: 'client_sequence' } });
            if (!record) {
                return await tx.systemSetting.create({ data: { key: 'client_sequence', value: '1' } });
            } else {
                const nextVal = parseInt(record.value) + 1;
                return await tx.systemSetting.update({
                    where: { key: 'client_sequence' },
                    data: { value: nextVal.toString() }
                });
            }
        });

        const nextNumber = parseInt(sequenceRecord.value);
        const code = `CUS/${String(nextNumber).padStart(5, '0')}`;
        
        console.log("Creating client with data:", { code, type, status, email });

        const client = await prisma.client.create({
            data: {
                code, type, status, 
                email: (email && typeof email === 'string' && email.trim() !== "") ? email.trim() : null, 
                phone, mobile, address,
                description: (req.body.description && req.body.description.trim() !== "") ? req.body.description.trim() : null,
                name, nicOrPassport, passportNo, drivingLicenseNo,
                companyName, brNumber, contactPersonName, contactPersonMobile,
                closeRelationName, closeRelationMobile,
                userId: (req.body.userId && req.body.userId.trim() !== "") ? req.body.userId : null,
                loyaltyPoints: parseFloat(req.body.loyaltyPoints) || 0,
                loyaltyEnabled: req.body.loyaltyEnabled === 'true' || req.body.loyaltyEnabled === true,
                loyaltyEarnRate: (req.body.loyaltyEarnRate && !isNaN(parseFloat(req.body.loyaltyEarnRate))) ? parseFloat(req.body.loyaltyEarnRate) : null,
                loyaltyRedeemRate: (req.body.loyaltyRedeemRate && !isNaN(parseFloat(req.body.loyaltyRedeemRate))) ? parseFloat(req.body.loyaltyRedeemRate) : null,
                intlDrivingLicenseFrontUrl,
                intlDrivingLicenseBackUrl,
                aaPermitUrl,
                doc1Url,
                doc2Url,
                utilityBillUrl,
                support1Url,
                support2Url,
                drivingLicenseFrontUrl,
                drivingLicenseBackUrl
            }
        });

        // Send Welcome Email asynchronously
        if (email && typeof email === 'string' && email.trim() !== "") {
            sendWelcomeEmail(email, name || companyName || 'Customer');
        }

        res.status(201).json(client);
    } catch (error) {
        console.error("Create Client Error:", error);
        res.status(500).json({ 
            message: "Failed to create customer: " + error.message, 
            error: error.message,
            prismaError: error.code 
        });
    }
};

// Get all customers
exports.getAllClients = async (req, res) => {
    try {
        const clients = await prisma.client.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(clients);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch customers" });
    }
};

// Update customer
exports.updateClient = async (req, res) => {
    console.log("CustomerManagement: updateClient payload received:", req.body);
    try {
        const { id } = req.params;
        const updateData = { ...req.body };

        if (updateData.email === "") {
            updateData.email = null;
        }
        if (updateData.userId === "") {
            updateData.userId = null;
        }
        if (updateData.description === "") {
            updateData.description = null;
        }

        if (updateData.loyaltyPoints !== undefined) {
            updateData.loyaltyPoints = parseFloat(updateData.loyaltyPoints) || 0;
        }
        if (updateData.loyaltyEarnRate !== undefined) {
            updateData.loyaltyEarnRate = (updateData.loyaltyEarnRate && !isNaN(parseFloat(updateData.loyaltyEarnRate))) ? parseFloat(updateData.loyaltyEarnRate) : null;
        }
        if (updateData.loyaltyRedeemRate !== undefined) {
            updateData.loyaltyRedeemRate = (updateData.loyaltyRedeemRate && !isNaN(parseFloat(updateData.loyaltyRedeemRate))) ? parseFloat(updateData.loyaltyRedeemRate) : null;
        }

        const client = await prisma.client.update({
            where: { id },
            data: updateData
        });
        console.log("Update Client Success:", client);
        res.json(client);
    } catch (error) {
        console.error("Update Client Error:", error);
        res.status(500).json({ 
            message: "Failed to update customer: " + error.message,
            error: error.message
        });
    }
};

// Delete customer
exports.deleteClient = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.client.delete({ where: { id } });
        res.json({ message: "Customer deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete customer" });
    }
};

// Check for NIC duplicate
exports.checkNic = async (req, res) => {
    try {
        const { nicOrPassport, excludeId } = req.query;
        const where = { nicOrPassport };
        if (excludeId) where.id = { not: excludeId };

        const customer = await prisma.client.findFirst({ where });
        res.json({ exists: !!customer, customer });
    } catch (error) {
        res.status(500).json({ message: "Error checking NIC" });
    }
};

// Check for Passport duplicate
exports.checkPassport = async (req, res) => {
    try {
        const { passportNo, excludeId } = req.query;
        const where = { passportNo };
        if (excludeId) where.id = { not: excludeId };

        const customer = await prisma.client.findFirst({ where });
        res.json({ exists: !!customer, customer });
    } catch (error) {
        res.status(500).json({ message: "Error checking Passport" });
    }
};

// Check for BR duplicate
exports.checkBr = async (req, res) => {
    try {
        const { brNumber, excludeId } = req.query;
        const where = { brNumber };
        if (excludeId) where.id = { not: excludeId };

        const customer = await prisma.client.findFirst({ where });
        res.json({ exists: !!customer, customer });
    } catch (error) {
        res.status(500).json({ message: "Error checking BR Number" });
    }
};

// Check for Email duplicate
exports.checkEmail = async (req, res) => {
    try {
        const { email, excludeId } = req.query;
        const where = { email };
        if (excludeId) where.id = { not: excludeId };

        const customer = await prisma.client.findFirst({ where });
        res.json({ exists: !!customer, customer });
    } catch (error) {
        res.status(500).json({ message: "Error checking Email" });
    }
};

// Archive customer
exports.archiveClient = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await prisma.client.update({
            where: { id },
            data: { status: 'ARCHIVED' }
        });
        res.json({ message: "Customer archived successfully", client });
    } catch (error) {
        res.status(500).json({ message: "Failed to archive customer" });
    }
};

// Unarchive customer
exports.unarchiveClient = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const client = await prisma.client.update({
            where: { id },
            data: { status: status || 'CONFIRMED' }
        });
        res.json({ message: "Customer unarchived successfully", client });
    } catch (error) {
        res.status(500).json({ message: "Failed to unarchive customer" });
    }
};
