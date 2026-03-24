const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log('Starting seed...');

    // 1. Create Brands
    const toyota = await prisma.vehicleBrand.upsert({
        where: { name: 'Toyota' },
        update: {},
        create: { name: 'Toyota' },
    });

    const honda = await prisma.vehicleBrand.upsert({
        where: { name: 'Honda' },
        update: {},
        create: { name: 'Honda' },
    });

    const bmw = await prisma.vehicleBrand.upsert({
        where: { name: 'BMW' },
        update: {},
        create: { name: 'BMW' },
    });

    console.log('Brands seeded: Toyota, Honda, BMW');

    // 2. Create Models
    const modelsData = [
        { name: 'Prius', brandId: toyota.id },
        { name: 'Corolla', brandId: toyota.id },
        { name: 'Vezel', brandId: honda.id },
        { name: 'Civic', brandId: honda.id },
        { name: '520d', brandId: bmw.id },
        { name: 'X5', brandId: bmw.id },
    ];

    const models = {};

    for (const model of modelsData) {
        const createdModel = await prisma.vehicleModel.upsert({
            where: {
                name_brandId: {
                    name: model.name,
                    brandId: model.brandId
                }
            },
            update: {},
            create: {
                name: model.name,
                brandId: model.brandId
            },
        });
        models[model.name] = createdModel;
        console.log(`Model seeded: ${model.name}`);
    }

    // 3. Create Vehicles
    // Ensure we have unique license plates
    const vehicleData = [
        {
            modelId: models['Prius'].id,
            year: 2022,
            licensePlate: 'CAB-1234',
            color: 'White',
            fuelType: 'Hybrid',
            transmission: 'Automatic',
            ownership: 'COMPANY',
            status: 'AVAILABLE',
            imageUrl: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&q=80&w=800',
            lastOdometer: 15000,
            features: 'GPS, Bluetooth, Reverse Camera'
        },
        {
            modelId: models['Corolla'].id,
            year: 2021,
            licensePlate: 'CBB-5678',
            color: 'Silver',
            fuelType: 'Petrol',
            transmission: 'Automatic',
            ownership: 'COMPANY',
            status: 'AVAILABLE',
            imageUrl: 'https://images.unsplash.com/photo-1550355291-bbee04a92027?auto=format&fit=crop&q=80&w=800',
            lastOdometer: 25000,
            features: 'Bluetooth, Cruise Control'
        },
        {
            modelId: models['Vezel'].id,
            year: 2023,
            licensePlate: 'CBE-9012',
            color: 'Black',
            fuelType: 'Hybrid',
            transmission: 'Automatic',
            ownership: 'COMPANY',
            status: 'AVAILABLE',
            imageUrl: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&q=80&w=800',
            lastOdometer: 8000,
            features: 'Sunroof, Leather Seats, Apple CarPlay'
        },
        {
            modelId: models['520d'].id,
            year: 2023,
            licensePlate: 'CBF-3456',
            color: 'Blue',
            fuelType: 'Diesel',
            transmission: 'Automatic',
            ownership: 'COMPANY',
            status: 'AVAILABLE',
            imageUrl: 'https://images.unsplash.com/photo-1555215695-3004980adade?auto=format&fit=crop&q=80&w=800',
            lastOdometer: 5000,
            features: 'Premium Sound, Heated Seats, Autopilot'
        }
    ];

    for (const v of vehicleData) {
        // Upsert based on licensePlate
        const vehicle = await prisma.vehicle.upsert({
            where: { licensePlate: v.licensePlate },
            update: {
                modelId: v.modelId, // Ensure model is updated too
                imageUrl: v.imageUrl,
                features: v.features,
                color: v.color,
                year: v.year,
                status: v.status
            },
            create: v,
        });
        console.log(`Vehicle seeded: ${v.licensePlate} (${v.color} ${v.year})`);
    }

    console.log('Seeding completed.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
