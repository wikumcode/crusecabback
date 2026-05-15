/**
 * Upfront invoices: lines before ADVANCE_PAID, optional subtotal row, then advance deduction(s).
 */
function partitionInvoiceLinesForAdvance(lines) {
    const arr = Array.isArray(lines) ? lines : [];
    const advance = arr.filter((l) => l?.code === 'ADVANCE_PAID');
    const beforeAdvance = arr.filter((l) => l?.code !== 'ADVANCE_PAID');
    const showSubtotal = advance.length > 0;
    const subTotal = beforeAdvance.reduce((s, l) => s + Number(l?.amount || 0), 0);
    return { showSubtotal, beforeAdvance, advance, subTotal };
}

module.exports = { partitionInvoiceLinesForAdvance };
