const prisma = require('../lib/prisma');
const { sendWelcomeEmail } = require('../utils/email');
const { getNextSequenceValue, getMongoClient } = require('../utils/sequence');

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

        // 1. Generate Code: CUS/00001 via sequence
        const nextNumber = await getNextSequenceValue('client_sequence');
        const code = `CUS/${String(nextNumber).padStart(5, '0')}`;
        
        console.log(`[CreateClient] Initiating for ${code} [${type}]`);

        // 2. Prepare Data
        const clientData = {
            code,
            type,
            status: (status === 'SUBMIT' || status === 'CONFIRMED') ? 'CONFIRMED' : (status || 'DRAFT'),
            email: (email && typeof email === 'string' && email.trim() !== "") ? email.trim() : null,
            phone,
            mobile,
            address,
            description: (req.body.description && req.body.description.trim() !== "") ? req.body.description.trim() : null,
            name,
            nicOrPassport,
            passportNo,
            drivingLicenseNo,
            companyName,
            brNumber,
            contactPersonName,
            contactPersonMobile,
            closeRelationName,
            closeRelationMobile,
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
        };

        // 3. Save using Prisma (Fast, shared connection)
        const client = await prisma.client.create({
            data: clientData
        });

        // 4. Async Email
        try {
            if (client.email) {
                sendWelcomeEmail(client.email, client.name || client.companyName || 'Valued Customer');
            }
        } catch (emailError) {
            console.error('Welcome email failed:', emailError.message);
        }

        res.status(201).json(client);
    } catch (error) {
        console.error('Create Client Error:', error);
        res.status(400).json({ 
            message: "Failed to create customer: " + (error.message || 'Unknown error'),
            error: error.message 
        });
    }
};

// Get all customers
exports.getAllClients = async (req, res) => {
    try {
        const { search, status, type } = req.query;
        const page = parseInt(req.query.page) || 1;
        const requestedLimit = parseInt(req.query.limit) || 20;
        const limit = Math.min(requestedLimit, 100);
        const skip = (page - 1) * limit;

        const where = {};
        if (status && status !== 'ALL') {
            where.status = status;
        }
        if (type && type !== 'ALL') {
            where.type = type;
        }
        if (search && typeof search === 'string') {
            const s = search.trim();
            where.OR = [
                { name: { contains: s, mode: 'insensitive' } },
                { companyName: { contains: s, mode: 'insensitive' } },
                { code: { contains: s, mode: 'insensitive' } },
                { email: { contains: s, mode: 'insensitive' } },
                { phone: { contains: s, mode: 'insensitive' } },
                { mobile: { contains: s, mode: 'insensitive' } }
            ];
        }

        const [clients, totalCount] = await Promise.all([
            prisma.client.findMany({
                where,
                orderBy: { code: 'desc' },
                skip,
                take: limit
            }),
            prisma.client.count({ where })
        ]);

        res.json({
            data: clients,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
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
        // Standardize data
        if (updateData.email === "") {
            updateData.email = null;
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

        // Use Prisma for the update
        const client = await prisma.client.update({
            where: { id },
            data: {
                ...updateData,
                updatedAt: new Date()
            }
        });

        console.log("Update Client Success:", client.id);
        res.json(client);
    } catch (error) {
        console.error("Update Client Error:", error);
        res.status(500).json({ 
            message: "Failed to update customer: " + (error.message || 'Unknown error'),
            error: error.message
        });
    }
};

// Delete customer
exports.deleteClient = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`[Delete] Permanently removing client ${id}`);

        await prisma.client.delete({
            where: { id }
        });

        res.json({ message: "Customer permanently deleted" });
    } catch (error) {
        console.error('Delete Client Error:', error);
        res.status(500).json({ 
            message: "Failed to delete customer",
            error: error.message
        });
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
        
        console.log(`[Archive] Processing client ${id}`);
        
        const client = await prisma.client.update({
            where: { id },
            data: { 
                status: 'ARCHIVED',
                updatedAt: new Date()
            }
        });

        res.json({ message: "Customer archived successfully", client });
    } catch (error) {
        console.error('Archive Client Error:', error);
        res.status(500).json({ 
            message: "Failed to archive customer", 
            error: error.message 
        });
    }
};

// Unarchive customer
exports.unarchiveClient = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        console.log(`[Unarchive] Restoring client ${id} to status ${status || 'CONFIRMED'}`);

        const client = await prisma.client.update({
            where: { id },
            data: { 
                status: status || 'CONFIRMED',
                updatedAt: new Date()
            }
        });

        res.json({ message: "Customer unarchived successfully", client });
    } catch (error) {
        console.error('Unarchive Client Error:', error);
        res.status(500).json({ 
            message: "Failed to unarchive customer",
            error: error.message
        });
    }
};
