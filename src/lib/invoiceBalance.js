/** Mirror backend invoice.controller sumPaymentsTowardBalance — keep in sync. */

const EPS = 0.01;

function invoiceHasAdvancePaidLine(lines) {
    const arr = Array.isArray(lines) ? lines : [];
    return arr.some((l) => l && l.code === 'ADVANCE_PAID' && Math.abs(Number(l.amount || 0)) > EPS);
}

/**
 * Sum of payments that reduce "balance due" on the invoice.
 * Advance-receipt payment rows mirror the "Less: Advance Payment" line already in invoice.total.
 */
function sumPaymentsTowardBalance(invoice) {
    if (!invoice) return 0;
    const payments = invoice.payments || [];
    const type = String(invoice.type || '').toUpperCase();
    if (type === 'UPFRONT' && invoiceHasAdvancePaidLine(invoice.lines)) {
        return payments.reduce((s, p) => {
            if (p.advanceReceiptId) return s;
            return s + Number(p.amount || 0);
        }, 0);
    }
    return payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}

function balanceDueForInvoice(invoice) {
    if (!invoice) return 0;
    const isReturn = String(invoice.type || '').toUpperCase() === 'RETURN';
    if (isReturn) return 0;
    const t = Number(invoice.total ?? 0);
    const paid = sumPaymentsTowardBalance(invoice);
    return Math.max(0, Math.round((t - paid) * 100) / 100);
}

module.exports = {
    sumPaymentsTowardBalance,
    balanceDueForInvoice
};
