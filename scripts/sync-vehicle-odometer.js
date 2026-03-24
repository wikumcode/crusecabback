const prisma = require('../src/lib/prisma');

function toDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const vehicles = await prisma.vehicle.findMany({
    select: {
      id: true,
      licensePlate: true,
      lastOdometer: true,
    }
  });

  let updated = 0;
  let unchanged = 0;

  for (const v of vehicles) {
    const candidates = [];

    const odos = await prisma.odometer.findMany({
      where: { vehicleId: v.id },
      select: { reading: true, date: true, createdAt: true, source: true },
      orderBy: { date: 'desc' },
      take: 10,
    });
    for (const o of odos) {
      const ts = toDateOrNull(o.date) || toDateOrNull(o.createdAt);
      if (ts && Number.isFinite(Number(o.reading))) {
        candidates.push({
          ts,
          reading: Number(o.reading),
          source: o.source || 'ODOMETER',
        });
      }
    }

    const contracts = await prisma.contract.findMany({
      where: {
        vehicleId: v.id,
        NOT: { endOdometer: null },
      },
      select: {
        endOdometer: true,
        actualReturnDate: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    for (const c of contracts) {
      const ts = toDateOrNull(c.actualReturnDate) || toDateOrNull(c.updatedAt);
      if (ts && Number.isFinite(Number(c.endOdometer))) {
        candidates.push({
          ts,
          reading: Number(c.endOdometer),
          source: 'CONTRACT_END',
        });
      }
    }

    const exchangeReturns = await prisma.vehicleExchange.findMany({
      where: { oldVehicleId: v.id },
      select: { oldVehicleReturnOdometer: true, oldVehicleReturnDate: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    for (const ex of exchangeReturns) {
      const ts = toDateOrNull(ex.oldVehicleReturnDate) || toDateOrNull(ex.updatedAt);
      if (ts && Number.isFinite(Number(ex.oldVehicleReturnOdometer))) {
        candidates.push({
          ts,
          reading: Number(ex.oldVehicleReturnOdometer),
          source: 'VEHICLE_EXCHANGE_RETURN',
        });
      }
    }

    const exchangeStarts = await prisma.vehicleExchange.findMany({
      where: { newVehicleId: v.id },
      select: { newVehicleStartOdometer: true, newVehicleStartDate: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    for (const ex of exchangeStarts) {
      const ts = toDateOrNull(ex.newVehicleStartDate) || toDateOrNull(ex.updatedAt);
      if (ts && Number.isFinite(Number(ex.newVehicleStartOdometer))) {
        candidates.push({
          ts,
          reading: Number(ex.newVehicleStartOdometer),
          source: 'VEHICLE_EXCHANGE_START',
        });
      }
    }

    if (!candidates.length) {
      unchanged++;
      continue;
    }

    candidates.sort((a, b) => b.ts.getTime() - a.ts.getTime());
    const latest = candidates[0];

    if (Number(v.lastOdometer) !== Number(latest.reading)) {
      await prisma.vehicle.update({
        where: { id: v.id },
        data: { lastOdometer: latest.reading },
      });
      updated++;
      console.log(`Updated ${v.licensePlate}: ${v.lastOdometer ?? 'null'} -> ${latest.reading} (${latest.source})`);
    } else {
      unchanged++;
    }
  }

  console.log(`Vehicles processed: ${vehicles.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

