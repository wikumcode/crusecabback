const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const { streamDatabaseBackupZip } = require('../lib/databaseBackup');
const {
    listSequenceSettings,
    resolveMaxForKey,
    upsertSequenceValue,
} = require('../lib/sequenceRegistry');

async function verifyAdminPassword(req, password) {
    if (!password) {
        return { ok: false, status: 400, message: 'Password is required' };
    }

    const currentUserId = req.user.id || req.user.userId;
    const user = await prisma.user.findFirst({
        where: {
            id: currentUserId,
            role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        },
    });

    if (!user) {
        return { ok: false, status: 403, message: 'Unauthorized: Administrative role required' };
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return { ok: false, status: 401, message: 'Incorrect password' };
    }

    return { ok: true, user };
}

exports.getDashboardStats = async (req, res) => {
    try {
        const [
            contractCount,
            vehicleCount,
            clientCount,
            availableVehicles,
            rentedVehicles,
            maintenanceVehicles,
            upcomingContracts,
            inProgressContracts
        ] = await Promise.all([
            prisma.contract.count(),
            prisma.vehicle.count(),
            prisma.client.count(),
            prisma.vehicle.count({ where: { status: 'AVAILABLE' } }),
            prisma.vehicle.count({ where: { status: 'RENTED' } }),
            prisma.vehicle.count({ where: { status: 'MAINTENANCE' } }),
            prisma.contract.count({ where: { status: 'UPCOMING' } }),
            prisma.contract.count({ where: { status: 'IN_PROGRESS' } })
        ]);

        res.json({
            counts: {
                contracts: contractCount,
                vehicles: vehicleCount,
                clients: clientCount,
            },
            fleetStatus: {
                available: availableVehicles,
                rented: rentedVehicles,
                maintenance: maintenanceVehicles,
            },
            activeContracts: {
                upcoming: upcomingContracts,
                inProgress: inProgressContracts,
            }
        });
    } catch (error) {
        console.error('Get Dashboard Stats Error:', error);
        res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
};

/** Demo loader previously used MongoDB-specific `isDemo` flags; re-implement with Prisma seed if needed. */
exports.loadDemoData = async (req, res) => {
    return res.status(501).json({
        message:
            'Demo data loader is not wired for PostgreSQL in this build. Use `prisma db seed`, SQL restore, or your own import.',
    });
};

exports.removeDemoData = async (req, res) => {
    return res.status(501).json({
        message:
            'Demo data removal relied on Mongo `isDemo` markers. Use a targeted SQL delete or restore from backup for PostgreSQL.',
    });
};

exports.downloadDatabaseBackup = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ message: 'Password is required' });

        const currentUserId = req.user.id || req.user.userId;
        const user = await prisma.user.findFirst({
            where: {
                id: currentUserId,
                role: { in: ['ADMIN', 'SUPER_ADMIN'] },
            },
        });

        if (!user) return res.status(403).json({ message: 'Unauthorized: Administrative role required' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });

        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            return res.status(500).json({ message: 'DATABASE_URL is not configured on the server' });
        }

        await streamDatabaseBackupZip(res, databaseUrl);
    } catch (error) {
        console.error('Database Backup Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || 'Failed to create database backup' });
        }
    }
};

exports.getSequences = async (req, res) => {
    try {
        const sequences = await listSequenceSettings();
        res.json(sequences);
    } catch (error) {
        console.error('Get Sequences Error:', error);
        res.status(500).json({ message: 'Failed to fetch sequences' });
    }
};

exports.updateSequence = async (req, res) => {
    try {
        const { key, value, password } = req.body;
        if (!key) return res.status(400).json({ message: 'Sequence key is required' });

        const auth = await verifyAdminPassword(req, password);
        if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

        const updated = await upsertSequenceValue(key, value);
        const suggested = await resolveMaxForKey(key);

        res.json({
            message: 'Sequence updated',
            sequence: {
                id: updated.id,
                key: updated.key,
                value: updated.value,
                suggestedValue: suggested == null ? null : String(suggested),
            },
        });
    } catch (error) {
        console.error('Update Sequence Error:', error);
        res.status(500).json({ message: error.message || 'Failed to update sequence' });
    }
};

exports.syncSequence = async (req, res) => {
    try {
        const { key, password } = req.body;
        if (!key) return res.status(400).json({ message: 'Sequence key is required' });

        const auth = await verifyAdminPassword(req, password);
        if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

        const maxUsed = await resolveMaxForKey(key);
        if (maxUsed == null) {
            return res.status(400).json({ message: 'This sequence type cannot be synced automatically' });
        }

        const updated = await upsertSequenceValue(key, maxUsed);

        res.json({
            message: `Sequence synced to highest existing number (${maxUsed}). Next document will use ${maxUsed + 1}.`,
            sequence: {
                id: updated.id,
                key: updated.key,
                value: updated.value,
                suggestedValue: String(maxUsed),
            },
        });
    } catch (error) {
        console.error('Sync Sequence Error:', error);
        res.status(500).json({ message: error.message || 'Failed to sync sequence' });
    }
};

exports.wipeAllData = async (req, res) => {
    try {
        const { password } = req.body;
        const auth = await verifyAdminPassword(req, password);
        if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

        const results = {};

        await prisma.$transaction(async (tx) => {
            const del = async (label, fn) => {
                const r = await fn();
                results[label] = r.count;
            };

            await del('AdvanceReversalCredit', () => tx.advanceReversalCredit.deleteMany({}));
            await del('InvoicePayment', () => tx.invoicePayment.deleteMany({}));
            await del('LedgerEntry', () => tx.ledgerEntry.deleteMany({}));
            await del('CreditNote', () => tx.creditNote.deleteMany({}));
            await del('AdvanceReceipt', () => tx.advanceReceipt.deleteMany({}));
            await del('VehicleExchange', () => tx.vehicleExchange.deleteMany({}));
            await del('Agreement', () => tx.agreement.deleteMany({}));
            await del('Invoice', () => tx.invoice.deleteMany({}));
            await del('Payment', () => tx.payment.deleteMany({}));
            await del('RentalAgreement', () => tx.rentalAgreement.deleteMany({}));
            await del('Booking', () => tx.booking.deleteMany({}));
            await del('Maintenance', () => tx.maintenance.deleteMany({}));
            await del('VehicleExpense', () => tx.vehicleExpense.deleteMany({}));
            await del('Odometer', () => tx.odometer.deleteMany({}));
            await del('Inspection', () => tx.inspection.deleteMany({}));
            await del('Quotation', () => tx.quotation.deleteMany({}));
            await del('VendorBillItem', () => tx.vendorBillItem.deleteMany({}));
            await del('VendorBill', () => tx.vendorBill.deleteMany({}));
            await del('VehiclePaymentSchedule', () => tx.vehiclePaymentSchedule.deleteMany({}));
            await del('Contract', () => tx.contract.deleteMany({}));
            await del('Vehicle', () => tx.vehicle.deleteMany({}));
            await del('VehicleModel', () => tx.vehicleModel.deleteMany({}));
            await del('VehicleBrand', () => tx.vehicleBrand.deleteMany({}));
            await del('FleetCategory', () => tx.fleetCategory.deleteMany({}));
            await del('Client', () => tx.client.deleteMany({}));
            await del('DriverDetails', () => tx.driverDetails.deleteMany({}));
            await del('VendorDetails', () => tx.vendorDetails.deleteMany({}));
            await del('EmailLog', () => tx.emailLog.deleteMany({}));

            const sequenceKeys = [
                'invoice_no_seq',
                'receipt_no_seq',
                'contract_no_seq',
                'booking_no_seq',
                'payment_no_seq',
                'quotation_no_seq',
                'advance_receipt_no_seq',
                'vendor_bill_no_seq',
                'client_sequence',
                'invoice_sequence',
                'credit_note_sequence',
                'vendor_sequence',
                'agreement_sequence',
            ];
            const seqDel = await tx.systemSetting.deleteMany({
                where: { key: { in: sequenceKeys } },
            });
            results['SystemSetting (sequence keys)'] = seqDel.count;

            const userPurge = await tx.user.deleteMany({
                where: { role: { notIn: ['ADMIN', 'SUPER_ADMIN'] } },
            });
            results['User (Non-Admins)'] = userPurge.count;
        }, { maxWait: 60000, timeout: 120000 });

        res.json({
            message: 'System wipe completed successfully',
            summary: results,
        });
    } catch (error) {
        console.error('Wipe All Data Error:', error);
        res.status(500).json({ message: error.message || 'Failed to wipe system data' });
    }
};
