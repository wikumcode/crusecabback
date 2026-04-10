const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function findBill() {
  try {
    const b = await prisma.vendorBill.findUnique({
      where: { billNumber: "Vendor-Bill/00001" },
      include: { 
        items: true, 
        maintenances: true, 
        expenses: true 
      }
    });
    console.log(JSON.stringify(b, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

findBill();
