/**
 * Removes duplicate P&L INCOME ledger rows created when a contract was marked COMPLETED
 * after a return invoice already recognized the same extra-charge income.
 *
 * Usage (dry run):
 *   node scripts/fix-duplicate-pl-income.js
 *
 * Apply deletes:
 *   node scripts/fix-duplicate-pl-income.js --apply
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const DUPLICATE_DESC = 'Late return extra charges income for';

async function main() {
    const apply = process.argv.includes('--apply');

    const duplicates = await prisma.ledgerEntry.findMany({
        where: {
            type: 'INCOME',
            description: { contains: DUPLICATE_DESC },
        },
        include: {
            contract: { select: { id: true, contractNo: true } },
            invoice: { select: { id: true, invoiceNo: true, type: true } },
        },
        orderBy: { createdAt: 'asc' },
    });

    const toDelete = [];
    for (const row of duplicates) {
        if (!row.contractId) continue;
        const returnInvoice = await prisma.invoice.findFirst({
            where: { contractId: row.contractId, type: 'RETURN' },
            select: { id: true, invoiceNo: true, status: true },
        });
        if (!returnInvoice) continue;

        const returnIncome = await prisma.ledgerEntry.findFirst({
            where: {
                contractId: row.contractId,
                invoiceId: returnInvoice.id,
                type: 'INCOME',
                amount: { gt: 0 },
            },
        });
        if (!returnIncome) continue;

        toDelete.push({
            ledgerId: row.id,
            amount: row.amount,
            contractNo: row.contract?.contractNo,
            upfrontInvoiceNo: row.invoice?.invoiceNo,
            returnInvoiceNo: returnInvoice.invoiceNo,
            returnIncomeAmount: returnIncome.amount,
        });
    }

    if (!toDelete.length) {
        console.log('No duplicate P&L income rows found.');
        return;
    }

    console.log(`Found ${toDelete.length} duplicate row(s):`);
    for (const d of toDelete) {
        console.log(
            `  - ${d.ledgerId}: LKR ${d.amount} on upfront ${d.upfrontInvoiceNo} ` +
                `(contract ${d.contractNo}; return ${d.returnInvoiceNo} already has LKR ${d.returnIncomeAmount})`
        );
    }

    if (!apply) {
        console.log('\nDry run only. Re-run with --apply to delete these rows.');
        return;
    }

    const ids = toDelete.map((d) => d.ledgerId);
    const result = await prisma.ledgerEntry.deleteMany({ where: { id: { in: ids } } });
    console.log(`\nDeleted ${result.count} duplicate ledger row(s).`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
