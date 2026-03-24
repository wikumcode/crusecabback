const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Use trimmed keys to match against trimmed database values
const mapping = {
    "Audi": "/cars/car_audi_rs6_1772427651620.png",
    "BMW": "/cars/car_bmw_m4_1772427427098.png",
    "Mercedes-Benz": "/cars/car_mercedes_gle_1772427462925.png",
    "Porsche": "/cars/car_porsche_911_1772427477881.png",
    "Land Rover": "/cars/car_range_rover_1772427490667.png",
    "Tesla": "/cars/car_tesla_y_1772427444137.png"
};

async function updateImages() {
    try {
        const vehicles = await prisma.vehicle.findMany({
            include: {
                vehicleModel: {
                    include: { brand: true }
                }
            }
        });

        console.log(`Found ${vehicles.length} vehicles.`);

        for (const v of vehicles) {
            if (!v.vehicleModel || !v.vehicleModel.brand) continue;

            const brandName = v.vehicleModel.brand.name.trim();
            const newPath = mapping[brandName];

            if (newPath) {
                await prisma.vehicle.update({
                    where: { id: v.id },
                    data: { imageUrl: newPath }
                });
                console.log(`SUCCESS: Updated ${brandName} [ID: ${v.id}] -> ${newPath}`);
            } else {
                console.log(`ERROR: No mapping found for brand [${brandName}] (original: "${v.vehicleModel.brand.name}")`);
            }
        }
    } catch (error) {
        console.error('Error updating images:', error);
    } finally {
        await prisma.$disconnect();
    }
}

updateImages();
