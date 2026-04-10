const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function deleteSpecificBill() {
  try {
    const bill = await prisma.vendorBill.findUnique({
      where: { billNumber: "Vendor-Bill/00001" }
    });

    if (!bill) {
      console.log("Bill Vendor-Bill/00001 not found.");
      return;
    }

    console.log(`Deleting bill ID: ${bill.id} (${bill.billNumber})`);

    await prisma.$transaction([
      prisma.maintenance.updateMany({
        where: { vendorBillId: bill.id },
        data: { vendorBillId: null, isRealized: false }
      }),
      prisma.vehicleExpense.updateMany({
        where: { vendorBillId: bill.id },
        data: { vendorBillId: null, isRealized: false }
      }),
      prisma.vendorBill.delete({ where: { id: bill.id } })
    ]);

    console.log("Deletion successful.");
  } catch (e) {
    console.error("Deletion failed:", e);
  } finally {
    await prisma.$disconnect();
  }
}

deleteSpecificBill();
