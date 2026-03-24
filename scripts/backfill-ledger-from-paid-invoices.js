const prisma = require('../src/lib/prisma');

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeLedgerForInvoice(inv) {
  const type = String(inv.type || '').toUpperCase();
  const lines = Array.isArray(inv.lines) ? inv.lines : [];
  const depositLine = lines.find(l => l?.code === 'DEPOSIT');
  const deposit = safeNum(depositLine?.amount || 0);

  if (type === 'RETURN') {
    const deductionsTotal = lines
      .filter(l => l && l.code !== 'DEPOSIT' && l.code !== 'NET')
      .reduce((sum, l) => sum + Math.max(0, -safeNum(l.amount || 0)), 0);

    return {
      income: deductionsTotal,
      liabilityDelta: deposit > 0 ? -Math.abs(deposit) : 0,
      incomeDesc: `Return settlement income for ${inv.invoiceNo}`,
      liabilityDesc: `Security deposit settlement for ${inv.invoiceNo}`,
    };
  }

  const total = safeNum(inv.total || 0);
  return {
    income: Math.max(0, total - deposit),
    liabilityDelta: deposit > 0 ? Math.abs(deposit) : 0,
    incomeDesc: `Invoice ${inv.invoiceNo} income (excl. deposit)`,
    liabilityDesc: `Security deposit liability for ${inv.invoiceNo}`,
  };
}

async function main() {
  const rebuild = process.argv.includes('--rebuild');

  const paid = await prisma.invoice.findMany({
    where: { status: 'PAID' },
    orderBy: { paidAt: 'asc' },
  });

  if (!paid.length) {
    console.log('No PAID invoices found.');
    return;
  }

  let created = 0;
  let skipped = 0;
  let rebuilt = 0;

  for (const inv of paid) {
    const existing = await prisma.ledgerEntry.findMany({
      where: { invoiceId: inv.id },
      select: { id: true }
    });

    if (existing.length && !rebuild) {
      skipped++;
      continue;
    }

    const { income, liabilityDelta, incomeDesc, liabilityDesc } = computeLedgerForInvoice(inv);

    await prisma.$transaction(async (tx) => {
      if (existing.length && rebuild) {
        await tx.ledgerEntry.deleteMany({ where: { invoiceId: inv.id } });
        rebuilt++;
      }

      if (income > 0) {
        await tx.ledgerEntry.create({
          data: {
            type: 'INCOME',
            amount: income,
            currency: inv.currency || 'LKR',
            description: incomeDesc,
            invoice: { connect: { id: inv.id } },
            contract: { connect: { id: inv.contractId } },
            customer: { connect: { id: inv.customerId } },
            vehicle: { connect: { id: inv.vehicleId } },
            createdAt: inv.paidAt || inv.updatedAt || new Date(),
          }
        });
      }

      if (liabilityDelta !== 0) {
        await tx.ledgerEntry.create({
          data: {
            type: 'LIABILITY',
            amount: liabilityDelta,
            currency: inv.currency || 'LKR',
            description: liabilityDesc,
            invoice: { connect: { id: inv.id } },
            contract: { connect: { id: inv.contractId } },
            customer: { connect: { id: inv.customerId } },
            vehicle: { connect: { id: inv.vehicleId } },
            createdAt: inv.paidAt || inv.updatedAt || new Date(),
          }
        });
      }
    });

    created++;
  }

  console.log(`PAID invoices: ${paid.length}`);
  console.log(`Created ledger for: ${created}`);
  console.log(`Skipped (already had ledger): ${skipped}`);
  console.log(`Rebuilt invoices (delete+recreate): ${rebuilt}${rebuild ? '' : ' (run with --rebuild to force)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

