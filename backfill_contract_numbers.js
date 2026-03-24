const prisma = require('./src/lib/prisma');

function pad(num, size) {
  const s = String(num);
  return s.length >= size ? s : '0'.repeat(size - s.length) + s;
}

function monthKey(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return { mm, yyyy, key: `contract_sequence_${yyyy}_${mm}` };
}

function buildContractNo(sequence, d) {
  const { mm, yyyy } = monthKey(d);
  return `CON/${mm}/${yyyy}/${pad(sequence, 5)}`;
}

async function main() {
  const missing = await prisma.contract.findMany({
    where: { OR: [{ contractNo: null }, { contractNo: '' }] },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true },
  });

  if (missing.length === 0) {
    console.log('No contracts missing contractNo.');
    return;
  }

  // Load existing sequence settings into memory
  const settings = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'contract_sequence_' } },
    select: { key: true, value: true },
  });
  const seq = new Map(settings.map(s => [s.key, Number(s.value) || 0]));

  let updated = 0;
  for (const c of missing) {
    const { key } = monthKey(new Date(c.createdAt));
    const next = (seq.get(key) || 0) + 1;
    seq.set(key, next);
    const contractNo = buildContractNo(next, new Date(c.createdAt));

    await prisma.contract.update({
      where: { id: c.id },
      data: { contractNo },
    });
    updated++;
  }

  // Persist sequence counters
  for (const [key, value] of seq.entries()) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
  }

  console.log(`Backfilled contractNo for ${updated} contract(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

