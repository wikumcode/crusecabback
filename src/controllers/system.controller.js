const prisma = require('../lib/prisma');
const { getMongoClient } = require('../utils/sequence');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

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

exports.loadDemoData = async (req, res) => {
    try {
        const mClient = await getMongoClient();
        // Fallback: If parsing fails, mClient.db() usually picks the right one from connection string
        const dbName = process.env.DATABASE_URL?.split('/').pop().split('?')[0] || undefined;
        const db = mClient.db(dbName);

        console.log(`[DemoData] Starting load for DB: ${db.databaseName}`);

        // 1. CLEAR EXISTING DEMO DATA FIRST (Idempotency)
        const collections = [
            'Vehicle', 'Client', 'VehicleModel', 'VehicleBrand', 
            'User', 'VendorDetails', 'DriverDetails', 'Odometer',
            'Contract', 'Booking', 'Invoice', 'Maintenance', 'VehicleExpense',
            'InvoicePayment', 'AdvanceReceipt'
        ];
        for (const coll of collections) {
            await db.collection(coll).deleteMany({ isDemo: true });
        }

        // 2. Brands and Models (Upsert-style)
        const brands = [
            { name: 'Toyota', models: ['Premio', 'Axio', 'Prius', 'Vitz'] },
            { name: 'Honda', models: ['Civic', 'Vezel', 'Grace', 'Fit'] },
            { name: 'Suzuki', models: ['WagonR', 'Alto', 'Every'] },
            { name: 'Nissan', models: ['Leaf', 'Dayz'] }
        ];

        const modelIds = [];
        for (const b of brands) {
            // Find or Create Brand
            let brand = await db.collection('VehicleBrand').findOne({ name: b.name });
            if (!brand) {
                const result = await db.collection('VehicleBrand').insertOne({ name: b.name, isDemo: true });
                brand = { _id: result.insertedId, name: b.name };
            }
            
            for (const m of b.models) {
                let model = await db.collection('VehicleModel').findOne({ name: m, brandId: brand._id });
                if (!model) {
                    const result = await db.collection('VehicleModel').insertOne({ 
                        name: m, 
                        brandId: brand._id, 
                        isDemo: true,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    modelIds.push(result.insertedId);
                } else {
                    modelIds.push(model._id);
                }
            }
        }

        // 3. Vendors (Users + Details)
        const vendorIds = [];
        const hashedPassword = await bcrypt.hash('password123', 10);
        for (let i = 1; i <= 3; i++) {
            const email = `demo.vendor${i}@rentix.com`;
            // Delete existing user if it's not a demo user but has our demo email (unlikely but safe)
            await db.collection('User').deleteOne({ email, isDemo: { $ne: true } });
            
            const user = await db.collection('User').insertOne({
                email,
                name: `Demo Vendor ${i}`,
                password: hashedPassword,
                role: 'ADMIN',
                isDemo: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            await db.collection('VendorDetails').insertOne({
                userId: user.insertedId,
                vendorCode: `VEN/DEMO${i}`,
                vendorType: i === 1 ? 'VEHICLE_OWNER' : 'SERVICE_VENDOR',
                phone: `071000000${i}`,
                isDemo: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            vendorIds.push(user.insertedId);
        }

        // 4. Vehicles
        const vehicleIds = [];
        for (let i = 1; i <= 25; i++) {
            const v = {
                licensePlate: `WP DEMO-${1000 + i}`,
                vin: `VIN-DEMO-${100000 + i}`,
                year: 2018 + (i % 6),
                modelId: modelIds[i % modelIds.length],
                fuelType: i % 3 === 0 ? 'Hybrid' : 'Petrol',
                transmission: 'Automatic',
                color: ['Pearl White', 'Silver', 'Black', 'Blue'][i % 4],
                status: i < 5 ? 'RENTED' : (i === 6 ? 'MAINTENANCE' : 'AVAILABLE'),
                dailyRentalRate: 4500 + (i * 100),
                dailyAllocatedKm: 100,
                ownership: i % 5 === 0 ? 'THIRD_PARTY' : 'COMPANY',
                vendorId: i % 5 === 0 ? vendorIds[0] : null,
                imageUrl: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&q=80&w=400',
                isDemo: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            const result = await db.collection('Vehicle').insertOne(v);
            vehicleIds.push(result.insertedId);
            
            await db.collection('Odometer').insertOne({
                vehicleId: result.insertedId,
                reading: 10000 + (i * 500),
                date: new Date(),
                source: 'INITIAL',
                isDemo: true
            });
        }

        // 5. Clients
        const clientIds = [];
        for (let i = 1; i <= 10; i++) {
            const result = await db.collection('Client').insertOne({
                code: `CUS/DEMO${i}`,
                type: i % 3 === 0 ? 'CORPORATE' : 'LOCAL',
                status: 'CONFIRMED',
                email: `demo.client${i}@example.com`,
                name: `Demo Customer ${i}`,
                phone: `077000000${i}`,
                nicOrPassport: `DEMO${i}V`,
                isDemo: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            clientIds.push(result.insertedId);
        }

        // 6. Drivers
        for (let i = 1; i <= 5; i++) {
            const user = await db.collection('User').insertOne({
                email: `demo.driver${i}@rentix.com`,
                name: `Demo Driver ${i}`,
                password: hashedPassword,
                role: 'DRIVER',
                isDemo: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            await db.collection('DriverDetails').insertOne({
                userId: user.insertedId,
                licenseNumber: `DL-DEMO-${i}`,
                status: 'ACTIVE',
                isDemo: true,
                createdAt: new Date()
            });
        }

        // 7. Contracts & Invoices
        for (let i = 0; i < 15; i++) {
            const status = i < 5 ? 'IN_PROGRESS' : (i < 10 ? 'COMPLETED' : 'UPCOMING');
            const pickup = new Date();
            pickup.setDate(pickup.getDate() - (10 - i));
            const dropoff = new Date(pickup);
            dropoff.setDate(dropoff.getDate() + 3);

            const contract = await db.collection('Contract').insertOne({
                contractNo: `CON-DEMO-${1000 + i}`,
                customerId: clientIds[i % clientIds.length],
                vehicleId: vehicleIds[i % vehicleIds.length],
                status: status,
                pickupDate: pickup,
                pickupTime: '09:00',
                dropoffDate: dropoff,
                dropoffTime: '09:00',
                appliedDailyRate: 5000,
                securityDeposit: 15000,
                fuelLevel: 'FULL',
                startOdometer: 15000,
                isDemo: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            if (status !== 'UPCOMING') {
                await db.collection('Invoice').insertOne({
                    invoiceNo: `INV-DEMO-${1000 + i}`,
                    sequence: 1000 + i,
                    contractId: contract.insertedId,
                    customerId: clientIds[i % clientIds.length],
                    vehicleId: vehicleIds[i % vehicleIds.length],
                    type: 'FINAL',
                    total: 15000,
                    status: 'PAID',
                    lines: JSON.stringify([{ description: 'Rental Fee', amount: 15000 }]),
                    isDemo: true,
                    createdAt: new Date()
                });
            }
        }

        // 8. Maintenance & Expenses
        for (let i = 1; i <= 10; i++) {
            await db.collection('Maintenance').insertOne({
                vehicleId: vehicleIds[i % vehicleIds.length],
                description: `Demo Service ${i}`,
                cost: 5000 + (i * 500),
                startDate: new Date(),
                status: 'DONE',
                isDemo: true,
                createdAt: new Date()
            });
            await db.collection('VehicleExpense').insertOne({
                vehicleId: vehicleIds[(i + 5) % vehicleIds.length],
                description: `Demo Fuel/Wash ${i}`,
                amount: 1500 + (i * 200),
                date: new Date(),
                isDemo: true,
                createdAt: new Date()
            });
        }

        res.json({ 
            message: 'Industrial demo data loaded successfully', 
            summary: {
                vehicles: 25,
                clients: 10,
                contracts: 15,
                vendors: 3,
                drivers: 5,
                maintenance: 10,
                expenses: 10
            }
        });
    } catch (error) {
        console.error('Load Demo Data Error:', error);
        res.status(500).json({ message: 'Failed to load demo data' });
    }
};

exports.removeDemoData = async (req, res) => {
    try {
        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        const collections = [
            'Vehicle', 'Client', 'VehicleModel', 'VehicleBrand', 
            'User', 'VendorDetails', 'DriverDetails', 'Odometer',
            'Contract', 'Booking', 'Invoice', 'Maintenance', 'VehicleExpense',
            'InvoicePayment', 'AdvanceReceipt'
        ];

        const results = {};
        for (const coll of collections) {
            try {
                const count = await db.collection(coll).deleteMany({ isDemo: true });
                results[coll] = count.deletedCount;
            } catch (err) {
                console.warn(`[DemoData] Removal skip for ${coll}:`, err.message);
                results[coll] = 0;
            }
        }

        res.json({ 
            message: 'Industrial demo data removed successfully', 
            summary: results 
        });
    } catch (error) {
        console.error('Remove Demo Data Error:', error);
        res.status(500).json({ message: error.message || 'Failed to remove demo data' });
    }
};

exports.wipeAllData = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ message: 'Password is required' });

        // 1. Verify Administrative Authority (supports both old and new token formats)
        const currentUserId = req.user.id || req.user.userId;
        const user = await prisma.user.findFirst({
            where: { 
                id: currentUserId, 
                role: { in: ['ADMIN', 'SUPER_ADMIN'] } 
            }
        });

        if (!user) return res.status(403).json({ message: 'Unauthorized: Administrative role required' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });

        // 2. Perform Wipe using Native Driver
        const mClient = await getMongoClient();
        // Use client.db() to automatically pick the DB from the connection string
        const db = mClient.db();

        console.log(`[Wipe] Initiating dynamic data purge for DB: ${db.databaseName}`);

        // 3. Discover all collections dynamically
        const collections = await db.listCollections().toArray();
        const allCollectionNames = collections.map(c => c.name);

        // Define collections to PRESERVE (Masters and Configs)
        const preserveList = [
            'User', 'SystemSetting', 'District', 'City', 
            'PermissionGroup', 'EmailSettings', 'email_settings', 
            'EmailTemplate', 'email_templates', 'EmailLog', 'email_logs'
        ];

        const results = {};
        for (const collName of allCollectionNames) {
            if (preserveList.includes(collName)) continue;

            try {
                const count = await db.collection(collName).deleteMany({});
                results[collName] = count.deletedCount;
            } catch (err) {
                console.warn(`[Wipe] Failed to clear ${collName}:`, err.message);
                results[collName] = 'Error';
            }
        }

        // 4. Selective Cleanup for Preserved Collections
        // Reset Sequences
        const sequenceKeys = [
            'invoice_no_seq', 'receipt_no_seq', 'contract_no_seq', 
            'booking_no_seq', 'payment_no_seq', 'quotation_no_seq', 
            'advance_receipt_no_seq', 'vendor_bill_no_seq', 'client_sequence'
        ];
        await db.collection('SystemSetting').deleteMany({
            key: { $in: sequenceKeys }
        });

        // Clear non-admin users
        const userPurge = await db.collection('User').deleteMany({
            role: { $nin: ['ADMIN', 'SUPER_ADMIN'] }
        });
        results['User (Non-Admins)'] = userPurge.deletedCount;

        res.json({ 
            message: 'Industrial system wipe completed successfully', 
            summary: results 
        });
    } catch (error) {
        console.error('Wipe All Data Error:', error);
        res.status(500).json({ message: error.message || 'Failed to wipe system data' });
    }
};
