const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
    console.log('--- Force Reseeding Rentix Demo Environment (Fixed Schema) ---');

    try {
        // 1. Cleanup
        console.log('Cleaning up existing data...');
        await prisma.payment.deleteMany({});
        await prisma.odometer.deleteMany({});
        await prisma.vehicleExchange.deleteMany({});
        await prisma.contract.deleteMany({});
        await prisma.booking.deleteMany({});
        await prisma.vehicle.deleteMany({});
        await prisma.client.deleteMany({});
        await prisma.driverDetails.deleteMany({});
        await prisma.vendorDetails.deleteMany({});
        await prisma.user.deleteMany({
            where: {
                role: { in: ['DRIVER', 'VENDOR'] }
            }
        });
        await prisma.vehicleModel.deleteMany({});
        await prisma.vehicleBrand.deleteMany({});

        // 2. Brands and Models
        console.log('Creating brands and models...');
        const toyota = await prisma.vehicleBrand.create({ data: { name: 'Toyota' } });
        const honda = await prisma.vehicleBrand.create({ data: { name: 'Honda' } });
        const nissan = await prisma.vehicleBrand.create({ data: { name: 'Nissan' } });

        const premio = await prisma.vehicleModel.create({ data: { name: 'Premio', brandId: toyota.id } });
        const axio = await prisma.vehicleModel.create({ data: { name: 'Axio', brandId: toyota.id } });
        const civic = await prisma.vehicleModel.create({ data: { name: 'Civic', brandId: honda.id } });

        // 3. Vehicles
        console.log('Creating vehicles...');
        const vehicles = [];
        const colors = ['Pearl White', 'Silver Metallic', 'Black', 'Wine Red', 'Dark Blue'];
        for (let i = 1; i <= 25; i++) {
            const v = await prisma.vehicle.create({
                data: {
                    licensePlate: `WP ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(66 + (i % 26))} ${1000 + i}`,
                    vin: `VIN-${100000 + i}`,
                    year: 2015 + (i % 8),
                    modelId: i % 2 === 0 ? premio.id : axio.id,
                    fuelType: (i % 3 === 0) ? 'Hybrid' : 'Petrol',
                    transmission: 'Automatic',
                    color: colors[i % colors.length],
                    status: (i === 1 || i === 5) ? 'RENTED' : 'AVAILABLE',
                    lastOdometer: 25000 + (i * 500),
                    dailyRentalRate: 4500 + (i * 100),
                    dailyAllocatedKm: 100,
                    ownership: 'COMPANY',
                    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Toyota_Premio_A15_%282007%29.jpg/640px-Toyota_Premio_A15_%282007%29.jpg`,
                    features: 'GPS,Bluetooth,AC,Reverse Camera'
                }
            });
            vehicles.push(v);
        }

        // 4. Clients
        console.log('Creating clients...');
        const clients = [];
        for (let i = 1; i <= 6; i++) {
            const c = await prisma.client.create({
                data: {
                    code: `CUS/${String(i).padStart(5, '0')}`,
                    type: i % 2 === 0 ? 'LOCAL' : 'FOREIGN',
                    status: 'CONFIRMED',
                    email: `client${i}@demo.com`,
                    name: `Client Name ${i}`,
                    phone: `011${2000000 + i}`,
                    mobile: `077${7000000 + i}`,
                    address: `${i}th Street, Colombo 0${i}`,
                    nicOrPassport: `NIC${5000000 + i}V`
                }
            });
            clients.push(c);
        }

        // 5. Drivers
        console.log('Creating drivers...');
        for (let i = 1; i <= 5; i++) {
            const password = await bcrypt.hash('password123', 10);
            const user = await prisma.user.create({
                data: {
                    email: `driver${i}@demo.com`,
                    password,
                    name: `Driver ${i}`,
                    role: 'DRIVER'
                }
            });
            await prisma.driverDetails.create({
                data: {
                    userId: user.id,
                    licenseNumber: `DL-${8000 + i}`,
                    licenseExpiryDate: new Date('2028-12-31'),
                    phoneNumber: `075${5000000 + i}`,
                    address: `Driver Haven ${i}, Negombo`,
                    nic: `NIC${8000 + i}V`,
                    status: 'ACTIVE'
                }
            });
        }

        // 6. Vendors
        console.log('Creating vendors...');
        for (let i = 1; i <= 3; i++) {
            const password = await bcrypt.hash('password123', 10);
            const user = await prisma.user.create({
                data: {
                    email: `vendor${i}@demo.com`,
                    password,
                    name: `Vendor ${i}`,
                    role: 'VENDOR'
                }
            });
            await prisma.vendorDetails.create({
                data: {
                    userId: user.id,
                    vendorCode: `VEN/${String(i).padStart(5, '0')}`,
                    phone: `011${4000000 + i}`,
                    address: `Vendor Hub ${i}, Kandy`,
                    nic: `NIC${9000 + i}V`,
                    vendorType: i === 3 ? 'SERVICE_VENDOR' : 'VEHICLE_OWNER'
                }
            });
        }

        // 7. Bookings, Contracts, Odometers
        console.log('Creating bookings, contracts, and odometers...');
        for (let i = 0; i < 12; i++) {
            const vehicle = vehicles[i % vehicles.length];
            const client = clients[i % clients.length];
            const status = i < 4 ? 'COMPLETED' : (i < 8 ? 'IN_PROGRESS' : 'UPCOMING');

            // Odometer History
            for (let j = 1; j <= 3; j++) {
                await prisma.odometer.create({
                    data: {
                        vehicleId: vehicle.id,
                        reading: (vehicle.lastOdometer || 30000) - (j * 800),
                        date: new Date(new Date().getTime() - (j * 20 * 24 * 60 * 60 * 1000)),
                        source: 'HISTORY_SEED'
                    }
                });
            }

            const contract = await prisma.contract.create({
                data: {
                    customerId: client.id,
                    vehicleId: vehicle.id,
                    status: status,
                    pickupDate: new Date(new Date().getTime() - (5 * 24 * 60 * 60 * 1000)),
                    pickupTime: '10:00 AM',
                    dropoffDate: new Date(new Date().getTime() + (10 * 24 * 60 * 60 * 1000)),
                    dropoffTime: '10:00 AM',
                    securityDeposit: 15000,
                    fuelLevel: 'FULL',
                    startOdometer: vehicle.lastOdometer - 100,
                    frontTyres: '80%',
                    rearTyres: '80%',
                    remark: 'Demo Contract'
                }
            });

            const booking = await prisma.booking.create({
                data: {
                    clientId: client.id,
                    vehicleId: vehicle.id,
                    startDate: contract.pickupDate,
                    endDate: contract.dropoffDate,
                    totalAmount: (vehicle.dailyRentalRate || 5000) * 5,
                    status: status === 'UPCOMING' ? 'PENDING' : (status === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED')
                }
            });

            if (status === 'COMPLETED') {
                await prisma.payment.create({
                    data: {
                        bookingId: booking.id,
                        amount: booking.totalAmount,
                        method: 'CASH',
                        status: 'PAID',
                        date: new Date()
                    }
                });
            }
        }

        console.log('--- Force Reseeding Completed Successfully ---');
        process.exit(0);
    } catch (error) {
        console.error('--- Reseeding Failed ---');
        console.error(error);
        process.exit(1);
    }
}

main();
