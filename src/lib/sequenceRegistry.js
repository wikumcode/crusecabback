const prisma = require('./prisma');

/** Global counters (not month-scoped). */
const GLOBAL_SEQUENCES = [
    { key: 'client_sequence', label: 'Customer', description: 'CUS/00001', category: 'global' },
    { key: 'vendor_sequence', label: 'Vendor', description: 'VEN/00001', category: 'global' },
    { key: 'invoice_sequence', label: 'Invoice', description: 'INV-YYYY-00001', category: 'global' },
    { key: 'credit_note_sequence', label: 'Credit Note', description: 'CN-YYYY-00001', category: 'global' },
    { key: 'agreement_sequence', label: 'Agreement', description: 'AGR-YYYY-00001', category: 'global' },
    { key: 'vendor_bill_sequence', label: 'Vendor Bill', description: 'Vendor-Bill/00001', category: 'global' },
];

/** Month-scoped document counters (key includes YYYY_MM). */
const MONTHLY_SEQUENCE_TYPES = [
    { prefix: 'contract', label: 'Contract', description: 'CON/MM/YYYY/00001' },
    { prefix: 'quotation', label: 'Quotation', description: 'QTN/MM/YYYY/00001' },
    { prefix: 'advance_receipt', label: 'Advance Receipt', description: 'AR/MM/YYYY/00001' },
    { prefix: 'rar', label: 'Advance Reversal', description: 'RAR/MM/YYYY/00001' },
];

const GLOBAL_KEY_ORDER = GLOBAL_SEQUENCES.map((s) => s.key);

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

function buildMonthlyKey(prefix, date = new Date()) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${prefix}_sequence_${yyyy}_${mm}`;
}

function getSequenceMeta(key) {
    const global = GLOBAL_SEQUENCES.find((s) => s.key === key);
    if (global) return { ...global };

    for (const monthly of MONTHLY_SEQUENCE_TYPES) {
        const period = parseMonthlyKey(key, monthly.prefix);
        if (period) {
            return {
                key,
                label: monthly.label,
                description: monthly.description,
                category: 'monthly',
                period: `${period.mm}/${period.yyyy}`,
            };
        }
    }

    const human = key
        .replace(/_/g, ' ')
        .replace(/\bsequence\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        key,
        label: human ? human.replace(/\b\w/g, (c) => c.toUpperCase()) : key,
        description: null,
        category: 'other',
        period: null,
    };
}

async function collectAllSequenceKeys() {
    const keys = new Set(GLOBAL_SEQUENCES.map((s) => s.key));
    const now = new Date();

    for (const { prefix } of MONTHLY_SEQUENCE_TYPES) {
        keys.add(buildMonthlyKey(prefix, now));
    }

    const existing = await prisma.systemSetting.findMany({
        where: { key: { contains: 'sequence' } },
        select: { key: true },
    });
    for (const row of existing) {
        keys.add(row.key);
    }

    return [...keys];
}

function sortSequenceEntries(a, b) {
    const ai = GLOBAL_KEY_ORDER.indexOf(a.key);
    const bi = GLOBAL_KEY_ORDER.indexOf(b.key);
    if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    }
    if (a.category === 'monthly' && b.category === 'monthly') {
        return b.key.localeCompare(a.key);
    }
    if (a.category === 'monthly') return 1;
    if (b.category === 'monthly') return -1;
    return a.key.localeCompare(b.key);
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
    const allKeys = await collectAllSequenceKeys();
    const settings = await prisma.systemSetting.findMany({
        where: { key: { in: allKeys } },
    });
    const byKey = Object.fromEntries(settings.map((s) => [s.key, s]));

    const enriched = await Promise.all(
        allKeys.map(async (key) => {
            const setting = byKey[key];
            const meta = getSequenceMeta(key);
            const suggested = await resolveMaxForKey(key);
            return {
                id: setting?.id ?? null,
                key,
                value: setting?.value ?? '0',
                label: meta.label,
                description: meta.description ?? null,
                category: meta.category,
                period: meta.period ?? null,
                suggestedValue: suggested == null ? null : String(suggested),
            };
        })
    );

    enriched.sort(sortSequenceEntries);
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
    GLOBAL_SEQUENCES,
    MONTHLY_SEQUENCE_TYPES,
    resolveMaxForKey,
    listSequenceSettings,
    upsertSequenceValue,
    getSequenceMeta,
};
