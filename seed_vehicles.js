const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
    try {
        console.log('Checking for existing vehicles...');
        const count = await prisma.vehicle.count();
        if (count > 0) {
            console.log(`Found ${count} vehicles. No seeding needed.`);
            const vehicles = await prisma.vehicle.findMany({
                include: { vehicleModel: { include: { brand: true } } }
            });
            console.log('Latest vehicles:', vehicles.map(v => `${v.vehicleModel?.brand?.name} ${v.vehicleModel?.name}`).join(', '));
            return;
        }

        console.log('No vehicles found. Creating sample brands, models, and vehicles...');

        // 1. Create Brands
        const toyota = await prisma.vehicleBrand.create({ data: { name: 'Toyota' } });
        const honda = await prisma.vehicleBrand.create({ data: { name: 'Honda' } });

        // 2. Create Models
        const camry = await prisma.vehicleModel.create({
            data: {
                name: 'Camry',
                brandId: toyota.id
            }
        });
        const civic = await prisma.vehicleModel.create({
            data: {
                name: 'Civic',
                brandId: honda.id
            }
        });

        // 3. Create Vehicles
        await prisma.vehicle.create({
            data: {
                modelId: camry.id,
                year: 2023,
                licensePlate: 'WP-ABC-1234',
                color: 'Black',
                fuelType: 'Petrol',
                transmission: 'Automatic',
                dailyRentalRate: 15000,
                status: 'AVAILABLE',
                imageUrl: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?q=80&w=800'
            }
        });

        await prisma.vehicle.create({
            data: {
                modelId: civic.id,
                year: 2022,
                licensePlate: 'WP-XYZ-5678',
                color: 'White',
                fuelType: 'Petrol',
                transmission: 'Automatic',
                dailyRentalRate: 12000,
                status: 'AVAILABLE',
                imageUrl: 'https://images.unsplash.com/photo-1594818379496-da1e345b0ded?q=80&w=800'
            }
        });

        console.log('Seeding completed successfully!');
    } catch (error) {
        console.error('Seeding error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

seed();
