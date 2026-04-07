const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

const BRANDS = [
    { name: 'Toyota', models: ['Prius', 'Corolla'] },
    { name: 'Honda', models: ['Vezel', 'Civic'] },
    { name: 'BMW', models: ['520d', 'X5'] },
    { name: 'Mercedes', models: ['C200', 'E250'] },
    { name: 'Audi', models: ['A4', 'Q5'] },
    { name: 'Tesla', models: ['Model 3', 'Model Y'] },
    { name: 'Nissan', models: ['Leaf', 'X-Trail'] },
    { name: 'Ford', models: ['Mustang', 'Everest'] }
];

const MODEL_IMAGES = {
    'Prius': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Toyota_Prius_ZVW50.jpg/800px-Toyota_Prius_ZVW50.jpg',
    'Corolla': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/2019_Toyota_Corolla_Icon_Tech_HEV_CVT_1.8_Front.jpg/800px-2019_Toyota_Corolla_Icon_Tech_HEV_CVT_1.8_Front.jpg',
    'Vezel': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Honda_VEZEL_HYBRID_Z_Honda_SENSING_%28DAA-RU3%29_front.jpg/800px-Honda_VEZEL_HYBRID_Z_Honda_SENSING_%28DAA-RU3%29_front.jpg',
    'Civic': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/2017_Honda_Civic_EX_VTEC_CVT_1.0_Front.jpg/800px-2017_Honda_Civic_EX_VTEC_CVT_1.0_Front.jpg',
    '520d': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/BMW_G30_IMG_0199.jpg/800px-BMW_G30_IMG_0199.jpg',
    'X5': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/2019_BMW_X5_xDrive30d_M_Sport_Automatic_3.0_Front.jpg/800px-2019_BMW_X5_xDrive30d_M_Sport_Automatic_3.0_Front.jpg',
    'C200': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/2019_Mercedes-Benz_C200_AMG_Line_EQ_Boost_1.5_Front.jpg/800px-2019_Mercedes-Benz_C200_AMG_Line_EQ_Boost_1.5_Front.jpg',
    'E250': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/2014_Mercedes-Benz_E_250_%28W_212_MY14%29_Avantgarde_sedan_%282015-08-07%29_01.jpg/800px-2014_Mercedes-Benz_E_250_%28W_212_MY14%29_Avantgarde_sedan_%282015-08-07%29_01.jpg',
    'A4': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/2018_Audi_A4_Sport_TDI_Quattro_S-A_2.0_Front.jpg/800px-2018_Audi_A4_Sport_TDI_Quattro_S-A_2.0_Front.jpg',
    'Q5': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/2018_Audi_Q5_S_Line_TDI_Quattro_S-A_2.0_Front.jpg/800px-2018_Audi_Q5_S_Line_TDI_Quattro_S-A_2.0_Front.jpg',
    'Model 3': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/2019_Tesla_Model_3_Performance_AWD_Front.jpg/800px-2019_Tesla_Model_3_Performance_AWD_Front.jpg',
    'Model Y': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/2021_Tesla_Model_Y_Long_Range_AWD_Front.jpg/800px-2021_Tesla_Model_Y_Long_Range_AWD_Front.jpg',
    'Leaf': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/2018_Nissan_Leaf_Tekna_Front.jpg/800px-2018_Nissan_Leaf_Tekna_Front.jpg',
    'X-Trail': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/2018_Nissan_X-Trail_Tekna_DCi_1.6_Front.jpg/800px-2018_Nissan_X-Trail_Tekna_DCi_1.6_Front.jpg',
    'Mustang': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/2018_Ford_Mustang_GT_5.0.jpg/800px-2018_Ford_Mustang_GT_5.0.jpg',
    'Everest': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/2016_Ford_Everest_Limited_front.jpg/800px-2016_Ford_Everest_Limited_front.jpg'
};

exports.loadDemoData = async (req, res) => {
    try {
        console.log('Loading demo data...');

        // 1. Create Brands and Models
        const modelList = [];
        for (const brandData of BRANDS) {
            const brand = await prisma.vehicleBrand.upsert({
                where: { name: brandData.name },
                update: {},
                create: { name: brandData.name }
            });

            for (const modelName of brandData.models) {
                const model = await prisma.vehicleModel.upsert({
                    where: {
                        name_brandId: {
                            name: modelName,
                            brandId: brand.id
                        }
                    },
                    update: {},
                    create: {
                        name: modelName,
                        brandId: brand.id
                    }
                });
                modelList.push(model);
            }
        }

        // 2. Create 25 Vehicles
        const vehicles = [];
        for (let i = 0; i < 25; i++) {
            const model = modelList[Math.floor(Math.random() * modelList.length)];
            const licensePlate = `LB-${1000 + i}`;
            const fuelTypes = ['Petrol', 'Diesel', 'Hybrid', 'Electric'];
            const transmissions = ['Automatic', 'Manual'];
            const colors = ['White', 'Black', 'Silver', 'Blue', 'Red', 'Grey'];

            const defaultFallback = 'https://images.unsplash.com/photo-1590362891991-f70092c4cd4e?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80';
            const carImage = MODEL_IMAGES[model.name] || defaultFallback;

            const vehicle = await prisma.vehicle.upsert({
                where: { licensePlate },
                update: { imageUrl: carImage },
                create: {
                    modelId: model.id,
                    year: 2020 + Math.floor(Math.random() * 5),
                    licensePlate,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    fuelType: fuelTypes[Math.floor(Math.random() * fuelTypes.length)],
                    transmission: transmissions[Math.floor(Math.random() * transmissions.length)],
                    status: 'AVAILABLE',
                    imageUrl: carImage,
                    dailyRentalRate: 5000 + Math.floor(Math.random() * 15000),
                    dailyAllocatedKm: 100,
                    lastOdometer: 1000 + Math.floor(Math.random() * 50000),
                    features: 'GPS, Bluetooth, Reverse Camera',
                    ownership: 'COMPANY'
                }
            });
            vehicles.push(vehicle);
        }

        // 3. Create 5 Clients
        const rawClients = [
            { name: 'John Doe', email: 'john@demo.com', type: 'LOCAL', mobile: '0771234561' },
            { name: 'Jane Smith', email: 'jane@demo.com', type: 'LOCAL', mobile: '0771234562' },
            { name: 'Acme Corp', email: 'info@acme.demo.com', type: 'CORPORATE', companyName: 'Acme Corp', mobile: '0112345678' },
            { name: 'Hans Mueller', email: 'hans@demo.com', type: 'FOREIGN', passportNo: 'N1234567', mobile: '0771234563' },
            { name: 'Globex Inc', email: 'contact@globex.demo.com', type: 'CORPORATE', companyName: 'Globex Inc', mobile: '0118765432' }
        ];

        const clients = [];
        for (const rc of rawClients) {
            const count = await prisma.client.count();
            const code = `CUS/${String(count + 1).padStart(5, '0')}`;
            const client = await prisma.client.upsert({
                where: { email: rc.email },
                update: {},
                create: {
                    ...rc,
                    code,
                    status: 'CONFIRMED',
                    address: 'Colombo, Sri Lanka',
                    phone: rc.mobile
                }
            });
            clients.push(client);
        }

        // 4. Create 5 Drivers
        const drivers = [];
        for (let i = 0; i < 5; i++) {
            const email = `driver${i + 1}@demo.com`;
            const user = await prisma.user.upsert({
                where: { email },
                update: {},
                create: {
                    email,
                    name: `Demo Driver ${i + 1}`,
                    role: 'DRIVER',
                    password: await bcrypt.hash('password123', 10)
                }
            });

            await prisma.driverDetails.upsert({
                where: { userId: user.id },
                update: {},
                create: {
                    userId: user.id,
                    licenseNumber: `DL-${10000 + i}`,
                    licenseExpiryDate: new Date('2030-01-01'),
                    phoneNumber: `07799988${i}`,
                    address: 'Driver Address ' + (i + 1),
                    nic: `NIC${10000 + i}V`,
                    status: 'ACTIVE'
                }
            });
            drivers.push(user);
        }

        // 5. Create 20 Bookings and Contracts
        const bookings = [];
        const contracts = [];
        let odometerCount = 0;

        for (let i = 0; i < 20; i++) {
            const vehicle = vehicles[i % vehicles.length];
            const client = clients[i % clients.length];
            const startDate = new Date();
            startDate.setDate(startDate.getDate() + (i * 2) - 15); // Better spread
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 3 + Math.floor(Math.random() * 5));

            const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            const totalAmount = (vehicle.dailyRentalRate || 5000) * days;

            // Create Booking
            const booking = await prisma.booking.create({
                data: {
                    clientId: client.id,
                    vehicleId: vehicle.id,
                    startDate,
                    endDate,
                    totalAmount,
                    status: i < 10 ? 'COMPLETED' : (i < 15 ? 'CONFIRMED' : 'PENDING')
                }
            });
            bookings.push(booking);

            // Create Contract
            const contract = await prisma.contract.create({
                data: {
                    customerId: client.id,
                    vehicleId: vehicle.id,
                    pickupDate: startDate,
                    pickupTime: "10:00",
                    dropoffDate: endDate,
                    dropoffTime: "10:00",
                    status: i < 5 ? 'COMPLETED' : (i < 12 ? 'IN_PROGRESS' : 'UPCOMING'),
                    securityDeposit: 15000,
                    fuelLevel: 'FULL',
                    startOdometer: vehicle.lastOdometer || 15000,
                    frontTyres: '100%',
                    rearTyres: '100%',
                    allocatedKm: 300,
                    extraMileageCharge: 50,
                    remark: 'Demo Contract generated via System API'
                }
            });
            contracts.push(contract);

            // Create Payment
            await prisma.payment.create({
                data: {
                    bookingId: booking.id,
                    amount: totalAmount,
                    method: i % 3 === 0 ? 'CREDIT_CARD' : 'CASH',
                    status: i < 12 ? 'PAID' : 'PENDING',
                    date: startDate
                }
            });

            // Odometer History
            for (let j = 1; j <= 3; j++) {
                await prisma.odometer.create({
                    data: {
                        vehicleId: vehicle.id,
                        reading: (vehicle.lastOdometer || 15000) - (j * 500),
                        date: new Date(new Date().getTime() - (j * 30 * 24 * 60 * 60 * 1000)),
                        source: 'HISTORY_SEED'
                    }
                });
                odometerCount++;
            }
        }

        // 6. Create 5 Demo Vendors
        const vendors = [];
        const vendorData = [
            { name: 'John Fleet Owner', email: 'owner1@demo.com', type: 'VEHICLE_OWNER', code: 'VEN/00001' },
            { name: 'Quick Rent Partner', email: 'owner2@demo.com', type: 'VEHICLE_OWNER', code: 'VEN/00002' },
            { name: 'Elite Service Pro', email: 'service@demo.com', type: 'SERVICE_VENDOR', code: 'VEN/00003' },
            { name: 'Island Logistics', email: 'partner1@demo.com', type: 'VEHICLE_OWNER', code: 'VEN/00004' },
            { name: 'Premier Motors', email: 'partner2@demo.com', type: 'SERVICE_VENDOR', code: 'VEN/00005' }
        ];

        for (const v of vendorData) {
            const user = await prisma.user.upsert({
                where: { email: v.email },
                update: {},
                create: {
                    email: v.email,
                    name: v.name,
                    role: 'VENDOR',
                    password: await bcrypt.hash('password123', 10)
                }
            });

            await prisma.vendorDetails.upsert({
                where: { userId: user.id },
                update: {},
                create: {
                    userId: user.id,
                    vendorCode: v.code,
                    vendorType: v.type,
                    phone: '+94 7712345' + Math.floor(100 + Math.random() * 900),
                    address: 'Demoland, Colombo ' + (Math.floor(Math.random() * 15) + 1),
                    nic: '1990123' + Math.floor(1000 + Math.random() * 9000)
                }
            });
            vendors.push(user);
        }

        // Assign vehicles to vendors (spread 10 vehicles)
        for (let i = 0; i < 10; i++) {
            await prisma.vehicle.update({
                where: { id: vehicles[i].id },
                data: { vendorId: vendors[i % 3].id } // Assign to first 3 primarily
            });
        }

        // 7. Create 20 Maintenance Records (Vehicle Repairs)
        const repairDescriptions = [
            'Engine Oil Change and Filter Replacement',
            'Brake Pad Replacement and Rotor Resurfacing',
            'Transmission Fluid Flush',
            'AC System Service and Gas Refill',
            'Suspension Bushing Replacement',
            'Tire Rotation and Wheel Alignment',
            'Battery Replacement',
            'Radiator Leak Repair',
            'Fuel Pump Replacement',
            'Spark Plug Service'
        ];

        for (let i = 0; i < 20; i++) {
            const vehicle = vehicles[Math.floor(Math.random() * vehicles.length)];
            const status = i < 8 ? 'DONE' : (i < 15 ? 'IN_PROGRESS' : 'PENDING');
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - (Math.floor(Math.random() * 45)));

            const endDate = status === 'DONE' ? new Date(startDate.getTime() + (2 * 24 * 60 * 60 * 1000)) : null;
            const cost = status === 'DONE' ? 5000 + Math.floor(Math.random() * 25000) : null;

            await prisma.maintenance.create({
                data: {
                    vehicleId: vehicle.id,
                    description: repairDescriptions[i % repairDescriptions.length],
                    startDate,
                    endDate,
                    cost,
                    status
                }
            });
        }

        // 8. Create 30 Vehicle Expenses
        const expenseTypes = [
            'Fuel Top-up',
            'Comprehensive Insurance Premium',
            'Full Vehicle Grooming and Buffing',
            'Parking Fees - Monthly Access',
            'Revenue License Renewal',
            'Spare Part: Wiper Blades',
            'Waybill Stamp Duty',
            'Highway Toll Top-up',
            'Security Sticker Fee',
            'Emission Test Fee'
        ];

        for (let i = 0; i < 30; i++) {
            const vehicle = vehicles[Math.floor(Math.random() * vehicles.length)];
            const date = new Date();
            date.setDate(date.getDate() - (Math.floor(Math.random() * 90)));

            await prisma.vehicleExpense.create({
                data: {
                    vehicleId: vehicle.id,
                    description: expenseTypes[i % expenseTypes.length],
                    amount: 500 + Math.floor(Math.random() * 40000),
                    date
                }
            });
        }

        const result = {
            vendors: vendors.length,
            vehicleBrands: BRANDS.length,
            vehicleModels: modelList.length,
            vehicles: vehicles.length,
            odometerRecords: odometerCount,
            vehicleRepairs: 20,
            vehicleExpenses: 30,
            contracts: contracts.length,
            invoices: bookings.length,
            payments: 20
        };

        res.json({ message: 'Demo data loaded successfully', summary: result });
    } catch (error) {
        console.error('Demo data load error:', error);
        res.status(500).json({ error: 'Failed to load demo data', details: error.message });
    }
};

exports.removeDemoData = async (req, res) => {
    try {
        console.log('Removing demo data...');

        const demoClients = await prisma.client.findMany({ where: { email: { endsWith: '@demo.com' } } });
        const clientIds = demoClients.map(c => c.id);

        // Include old demo formats (LB-10, specific WP plates, and VINs from seed_now.js)
        const demoVehicles = await prisma.vehicle.findMany({
            where: {
                OR: [
                    { licensePlate: { startsWith: 'LB-10' } },
                    { vin: { startsWith: 'VIN-100' } },
                    { licensePlate: { in: ['WP CAB-1234', 'WP CBA-9876', 'WP CBB-5555', 'WP CBC-7777'] } }
                ]
            }
        });
        const vehicleIds = demoVehicles.map(v => v.id);

        const demoUsers = await prisma.user.findMany({ where: { email: { endsWith: '@demo.com' } } });
        const userIds = demoUsers.map(u => u.id);

        // Cleanup in order
        await prisma.odometer.deleteMany({ where: { OR: [{ vehicleId: { in: vehicleIds } }, { source: 'HISTORY_SEED' }] } });

        const demoBookings = await prisma.booking.findMany({
            where: { OR: [{ clientId: { in: clientIds } }, { vehicleId: { in: vehicleIds } }] }
        });
        const bookingIds = demoBookings.map(b => b.id);

        await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
        await prisma.rentalAgreement.deleteMany({ where: { bookingId: { in: bookingIds } } });

        const demoContracts = await prisma.contract.findMany({
            where: { OR: [{ customerId: { in: clientIds } }, { vehicleId: { in: vehicleIds } }] }
        });
        const contractIds = demoContracts.map(c => c.id);

        await prisma.vehicleExchange.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
        await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });

        await prisma.driverDetails.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.vendorDetails.deleteMany({ where: { userId: { in: userIds } } });

        await prisma.maintenance.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
        await prisma.vehicleExpense.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
        await prisma.inspection.deleteMany({ where: { vehicleId: { in: vehicleIds } } });

        await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
        await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });

        const result = { status: 'Cleanup complete' };

        res.json({ message: 'Demo data removed successfully', result });
    } catch (error) {
        console.error('Demo cleanup error:', error);
        res.status(500).json({ error: 'Failed to remove demo data', details: error.message });
    }
};

exports.wipeAllData = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ message: 'Password is required' });

        const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password. Wipe aborted.' });

        console.log('Initiating full system data wipe by Super Admin...');

        // 1. Delete all transactional data
        await prisma.ledgerEntry.deleteMany({});
        await prisma.invoice.deleteMany({});
        await prisma.creditNote.deleteMany({});
        await prisma.vendorBillItem.deleteMany({});
        await prisma.vendorBill.deleteMany({});
        await prisma.vehiclePaymentSchedule.deleteMany({});
        await prisma.payment.deleteMany({});
        
        await prisma.odometer.deleteMany({});
        await prisma.vehicleExchange.deleteMany({});
        await prisma.contract.deleteMany({});
        await prisma.booking.deleteMany({});
        await prisma.quotation.deleteMany({});
        await prisma.maintenance.deleteMany({});
        await prisma.inspection.deleteMany({});
        await prisma.rentalAgreement.deleteMany({});

        // 2. Delete all inventory/customer data
        await prisma.vehicle.deleteMany({});
        await prisma.fleetCategory.deleteMany({});
        await prisma.client.deleteMany({});

        // 3. Delete Profiles (Driver/Vendor)
        await prisma.driverDetails.deleteMany({});
        await prisma.vendorDetails.deleteMany({});

        // 4. Delete Users who are NOT ADMIN or SUPER_ADMIN
        const deletedUsers = await prisma.user.deleteMany({
            where: {
                role: { notIn: ['ADMIN', 'SUPER_ADMIN'] }
            }
        });

        // 5. Delete Meta Data (Models/Brands)
        await prisma.vehicleExpense.deleteMany({});
        await prisma.vehicleModel.deleteMany({});
        await prisma.vehicleBrand.deleteMany({});
        await prisma.emailLog.deleteMany({});

        // 6. Reset Sequences
        await prisma.systemSetting.deleteMany({
            where: {
                key: { contains: '_sequence' }
            }
        });

        res.json({ message: 'System purged and sequences reset successfully', usersDeleted: deletedUsers.count });
    } catch (error) {
        console.error('System wipe error:', error);
        res.status(500).json({ error: 'Failed to wipe system data', details: error.message });
    }
};

exports.getSequences = async (req, res) => {
    try {
        const sequences = await prisma.systemSetting.findMany({
            where: {
                key: { contains: '_sequence' }
            }
        });
        res.json(sequences);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch sequences' });
    }
};

exports.updateSequence = async (req, res) => {
    try {
        const { key, value, password } = req.body;
        if (!password) return res.status(400).json({ message: 'Password is required' });

        const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });

        const updated = await prisma.systemSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) }
        });

        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: 'Failed to update sequence' });
    }
};
