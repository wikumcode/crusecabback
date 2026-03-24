const prisma = require('../src/lib/prisma');

function pad(num, size) {
  const s = String(num);
  return s.length >= size ? s : '0'.repeat(size - s.length) + s;
}

function buildContractNo(sequence, date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `CON/${mm}/${yyyy}/${pad(sequence, 5)}`;
}

function seqKey(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `contract_sequence_${yyyy}_${mm}`;
}

function parseSeq(contractNo) {
  if (!contractNo || typeof contractNo !== 'string') return null;
  const m = /^CON\/(\d{2})\/(\d{4})\/(\d{5})$/.exec(contractNo.trim());
  if (!m) return null;
  return { mm: m[1], yyyy: m[2], seq: Number(m[3]) };
}

async function main() {
  const missing = await prisma.contract.findMany({
    where: {
      OR: [
        { contractNo: { isSet: false } },
        { contractNo: null },
        { contractNo: '' },
      ]
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true, contractNo: true }
  });

  if (!missing.length) {
    console.log('No contracts missing contractNo.');
    return;
  }

  // Preload existing contract numbers to determine per-month max sequence.
  const existing = await prisma.contract.findMany({
    where: {
      AND: [
        { contractNo: { isSet: true } },
        { NOT: [{ contractNo: null }, { contractNo: '' }] }
      ]
    },
    select: { contractNo: true }
  });

  const maxByKey = new Map(); // key -> max seq
  for (const c of existing) {
    const parsed = parseSeq(c.contractNo);
    if (!parsed) continue;
    const key = `contract_sequence_${parsed.yyyy}_${parsed.mm}`;
    const cur = maxByKey.get(key) || 0;
    if (parsed.seq > cur) maxByKey.set(key, parsed.seq);
  }

  const updates = [];
  for (const c of missing) {
    const d = c.createdAt ? new Date(c.createdAt) : new Date();
    const key = seqKey(d);
    const current = maxByKey.get(key) || 0;
    const next = current + 1;
    maxByKey.set(key, next);
    updates.push({ id: c.id, key, next, contractNo: buildContractNo(next, d) });
  }

  await prisma.$transaction(async (tx) => {
    // Persist per-month counters to SystemSetting.
    for (const [key, max] of maxByKey.entries()) {
      // Only set keys that exist in our update set (avoid touching unrelated months).
      if (!updates.some(u => u.key === key)) continue;
      const setting = await tx.systemSetting.findUnique({ where: { key } });
      if (setting) {
        const cur = Number(setting.value) || 0;
        if (max > cur) {
          await tx.systemSetting.update({ where: { key }, data: { value: String(max) } });
        }
      } else {
        await tx.systemSetting.create({ data: { key, value: String(max) } });
      }
    }

    for (const u of updates) {
      await tx.contract.update({
        where: { id: u.id },
        data: { contractNo: u.contractNo }
      });
    }
  });

  console.log(`Backfilled contractNo for ${updates.length} contract(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

