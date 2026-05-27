const prisma = require('./prisma');

function maxFromParsed(values) {
    const nums = values.map((v) => (Number.isFinite(v) ? v : null)).filter((v) => v != null);
    return nums.length ? Math.max(...nums) : 0;
}

function parseSuffixNumber(str, regex) {
    if (!str) return null;
    const m = regex.exec(String(str).trim());
    return m ? parseInt(m[1], 10) : null;
}

function parseMonthlyKey(key, prefix) {
    const m = new RegExp(`^${prefix}_sequence_(\\d{4})_(\\d{2})$`).exec(key);
    if (!m) return null;
    return { yyyy: m[1], mm: m[2] };
}

async function resolveMaxForKey(key) {
    if (key === 'invoice_sequence') {
        const agg = await prisma.invoice.aggregate({ _max: { sequence: true } });
        return agg._max.sequence || 0;
    }

    if (key === 'credit_note_sequence') {
        const agg = await prisma.creditNote.aggregate({ _max: { sequence: true } });
        return agg._max.sequence || 0;
    }

    if (key === 'agreement_sequence') {
        const agg = await prisma.agreement.aggregate({ _max: { sequence: true } });
        return agg._max.sequence || 0;
    }

    if (key === 'client_sequence') {
        const rows = await prisma.client.findMany({ select: { code: true } });
        return maxFromParsed(rows.map((r) => parseSuffixNumber(r.code, /^CUS\/(\d+)$/i)));
    }

    if (key === 'vendor_sequence') {
        const rows = await prisma.vendorDetails.findMany({
            where: { vendorCode: { not: null } },
            select: { vendorCode: true },
        });
        return maxFromParsed(rows.map((r) => parseSuffixNumber(r.vendorCode, /^VEN\/(\d+)$/i)));
    }

    if (key === 'vendor_bill_sequence') {
        const rows = await prisma.vendorBill.findMany({
            where: { billNumber: { not: null } },
            select: { billNumber: true },
        });
        return maxFromParsed(
            rows.map((r) => parseSuffixNumber(r.billNumber, /^Vendor-Bill\/(\d+)$/i))
        );
    }

    const contractPeriod = parseMonthlyKey(key, 'contract');
    if (contractPeriod) {
        const prefix = `CON/${contractPeriod.mm}/${contractPeriod.yyyy}/`;
        const rows = await prisma.contract.findMany({
            where: { contractNo: { startsWith: prefix } },
            select: { contractNo: true },
        });
        return maxFromParsed(
            rows.map((r) => parseSuffixNumber(r.contractNo, /\/(\d+)$/))
        );
    }

    const arPeriod = parseMonthlyKey(key, 'advance_receipt');
    if (arPeriod) {
        const prefix = `AR/${arPeriod.mm}/${arPeriod.yyyy}/`;
        const rows = await prisma.advanceReceipt.findMany({
            where: { receiptNo: { startsWith: prefix } },
            select: { sequence: true },
        });
        return maxFromParsed(rows.map((r) => r.sequence));
    }

    const rarPeriod = parseMonthlyKey(key, 'rar');
    if (rarPeriod) {
        const prefix = `RAR/${rarPeriod.mm}/${rarPeriod.yyyy}/`;
        const rows = await prisma.advanceReversalCredit.findMany({
            where: { rarNo: { startsWith: prefix } },
            select: { sequence: true },
        });
        return maxFromParsed(rows.map((r) => r.sequence));
    }

    const qPeriod = parseMonthlyKey(key, 'quotation');
    if (qPeriod) {
        const prefix = `QTN/${qPeriod.mm}/${qPeriod.yyyy}/`;
        const rows = await prisma.quotation.findMany({
            where: { quotationNo: { startsWith: prefix } },
            select: { quotationNo: true },
        });
        return maxFromParsed(
            rows.map((r) => parseSuffixNumber(r.quotationNo, /\/(\d+)$/))
        );
    }

    return null;
}

async function listSequenceSettings() {
    const settings = await prisma.systemSetting.findMany({
        where: { key: { contains: 'sequence' } },
        orderBy: { key: 'asc' },
    });

    const enriched = await Promise.all(
        settings.map(async (setting) => {
            const suggested = await resolveMaxForKey(setting.key);
            return {
                id: setting.id,
                key: setting.key,
                value: setting.value,
                suggestedValue: suggested == null ? null : String(suggested),
            };
        })
    );

    return enriched;
}

async function upsertSequenceValue(key, value) {
    const numeric = parseInt(String(value), 10);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error('Sequence value must be a non-negative integer');
    }

    return prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: String(numeric) },
        update: { value: String(numeric) },
    });
}

module.exports = {
    resolveMaxForKey,
    listSequenceSettings,
    upsertSequenceValue,
};
