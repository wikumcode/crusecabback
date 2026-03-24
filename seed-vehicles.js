const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("Seeding vehicles...");

    const brand1 = await prisma.vehicleBrand.upsert({
        where: { name: 'BMW' },
        update: {},
        create: { name: 'BMW' }
    });
    const brand2 = await prisma.vehicleBrand.upsert({
        where: { name: 'Tesla' },
        update: {},
        create: { name: 'Tesla' }
    });
    const brand3 = await prisma.vehicleBrand.upsert({
        where: { name: 'Mercedes-Benz' },
        update: {},
        create: { name: 'Mercedes-Benz' }
    });
    const brand4 = await prisma.vehicleBrand.upsert({
        where: { name: 'Porsche' },
        update: {},
        create: { name: 'Porsche' }
    });

    const model1 = await prisma.vehicleModel.upsert({
        where: { name_brandId: { name: 'M4 Competition', brandId: brand1.id } },
        update: {},
        create: { name: 'M4 Competition', brandId: brand1.id }
    });
    const model2 = await prisma.vehicleModel.upsert({
        where: { name_brandId: { name: 'Model Y', brandId: brand2.id } },
        update: {},
        create: { name: 'Model Y', brandId: brand2.id }
    });
    const model3 = await prisma.vehicleModel.upsert({
        where: { name_brandId: { name: 'GLE 450', brandId: brand3.id } },
        update: {},
        create: { name: 'GLE 450', brandId: brand3.id }
    });
    const model4 = await prisma.vehicleModel.upsert({
        where: { name_brandId: { name: '911 Carrera', brandId: brand4.id } },
        update: {},
        create: { name: '911 Carrera', brandId: brand4.id }
    });

    await prisma.vehicle.upsert({
        where: { licensePlate: 'WP CAB-1234' },
        update: { imageUrl: '/cars/car_bmw_m4.png' },
        create: {
            modelId: model1.id,
            year: 2023,
            licensePlate: 'WP CAB-1234',
            color: 'Black',
            fuelType: 'Petrol',
            transmission: 'Automatic',
            status: 'AVAILABLE',
            imageUrl: '/cars/car_bmw_m4.png'
        }
    });

    await prisma.vehicle.upsert({
        where: { licensePlate: 'WP CBA-9876' },
        update: { imageUrl: '/cars/car_tesla_y.png' },
        create: {
            modelId: model2.id,
            year: 2024,
            licensePlate: 'WP CBA-9876',
            color: 'White',
            fuelType: 'Electric',
            transmission: 'Automatic',
            status: 'AVAILABLE',
            imageUrl: '/cars/car_tesla_y.png'
        }
    });

    await prisma.vehicle.upsert({
        where: { licensePlate: 'WP CBB-5555' },
        update: { imageUrl: '/cars/car_mercedes_gle.png' },
        create: {
            modelId: model3.id,
            year: 2023,
            licensePlate: 'WP CBB-5555',
            color: 'Silver',
            fuelType: 'Hybrid',
            transmission: 'Automatic',
            status: 'AVAILABLE',
            imageUrl: '/cars/car_mercedes_gle.png'
        }
    });

    await prisma.vehicle.upsert({
        where: { licensePlate: 'WP CBC-7777' },
        update: { imageUrl: '/cars/car_porsche_911.png' },
        create: {
            modelId: model4.id,
            year: 2024,
            licensePlate: 'WP CBC-7777',
            color: 'Grey',
            fuelType: 'Petrol',
            transmission: 'Automatic',
            status: 'AVAILABLE',
            imageUrl: '/cars/car_porsche_911.png'
        }
    });

    console.log("Seeding complete. 4 demo vehicles created/updated.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
