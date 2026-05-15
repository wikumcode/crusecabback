const prisma = require('../lib/prisma');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const { getMongoClient, getNextSequenceValue } = require('../utils/sequence');
const { ObjectId } = require('mongodb');
const { sendTemplateEmail } = require('../services/email/email.service');
const { DOCUMENT_PRINT_STYLES } = require('../lib/documentPrintStyles');
const { formatDateTime } = require('../lib/dates');

const INVOICE_SEQ_KEY = 'invoice_sequence';
const CREDIT_NOTE_SEQ_KEY = 'credit_note_sequence';
const INVOICE_SHARE_TOKEN_TTL = '7d';

function pad(num, size) {
    const s = String(num);
    return s.length >= size ? s : '0'.repeat(size - s.length) + s;
}

function buildInvoiceNo(sequence, date = new Date()) {
    const year = date.getFullYear();
    return `INV-${year}-${pad(sequence, 5)}`;
}

function buildCreditNoteNo(sequence, date = new Date()) {
    const year = date.getFullYear();
    return `CN-${year}-${pad(sequence, 5)}`;
}

function getBackendBaseUrlFromReq(req) {
    // 1. Check for explicit environment variable first
    if (process.env.BACKEND_URL) {
        return process.env.BACKEND_URL.replace(/\/$/, '');
    }

    // 2. Fallback to request host/origin
    const protocol = req.protocol || 'https';
    const host = req.headers.host;
    
    if (host) {
        return `${protocol}://${host}`;
    }

    // 3. Absolute fallback
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return 'http://localhost:5000';
    try {
        return new URL(origin).origin;
    } catch {
        return 'http://localhost:5000';
    }
}

function buildInvoiceShareLink(req, invoiceId) {
    const token = jwt.sign({ invoiceId }, process.env.JWT_SECRET, { expiresIn: INVOICE_SHARE_TOKEN_TTL });
    const backendBase = getBackendBaseUrlFromReq(req);
    return `${backendBase}/api/invoices/share/${invoiceId}?token=${encodeURIComponent(token)}`;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const MONEY_EPS = 0.01;

/**
 * Prisma's default interactive transaction timeout is 5s. Invoice/ledger flows
 * here issue several round-trips (find existing invoice, find advance receipt,
 * sequence read/write, invoice create/update, status checks…) which on a remote
 * Mongo Atlas cluster routinely exceed 5s. Bumping mirrors what
 * advanceReceipt.controller.js already does for the same reason.
 */
const TX_OPTS_INVOICE = {
    maxWait: 15000,
    timeout: 45000,
};

function roundMoney(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
}

function sumInvoicePayments(payments) {
    if (!Array.isArray(payments)) return 0;
    return payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}

function invoiceHasAdvancePaidLine(lines) {
    const arr = Array.isArray(lines) ? lines : [];
    return arr.some((l) => l && l.code === 'ADVANCE_PAID' && Math.abs(Number(l.amount || 0)) > MONEY_EPS);
}

/**
 * Cash applied toward the printed balance due. Advance-receipt rows duplicate the "Less: Advance Payment"
 * already baked into invoice.total — excluding them avoids balance due = total − advance twice.
 */
function sumPaymentsTowardBalance(inv) {
    if (!inv) return 0;
    const payments = inv.payments || [];
    const type = String(inv.type || '').toUpperCase();
    if (type === 'UPFRONT' && invoiceHasAdvancePaidLine(inv.lines)) {
        return payments.reduce((s, p) => {
            if (p.advanceReceiptId) return s;
            return s + Number(p.amount || 0);
        }, 0);
    }
    return sumInvoicePayments(payments);
}

exports.sumPaymentsTowardBalance = sumPaymentsTowardBalance;

/** Legacy proportional split (invoice total × deposit ratio). Prefer computeDepositFirstLedgerSplit for UPFRONT. */
function upfrontIncomeLiabilitySplit(total, deposit, paymentAmount) {
    const T = Number(total);
    const D = Number(deposit);
    const P = Number(paymentAmount);
    if (P <= MONEY_EPS || Math.abs(T) < MONEY_EPS) return { income: 0, liability: 0 };
    const liability = roundMoney((P * D) / T);
    const income = roundMoney(Math.max(0, P - liability));
    return { income, liability };
}

/**
 * Deposit-first waterfall for UPFRONT cash: cumulative receipts fill security deposit liability up to D, then rental income.
 * priorCashBeforeThisPayment = sum of amounts already posted on this invoice before this receipt (chronological).
 * Handles: advance &lt; D (all to liability), advance = D (all liability), advance &gt; D (D liability + excess income),
 * and later payments after partial deposits (fills remaining D then income).
 */
function computeDepositFirstLedgerSplit(depositLineAmount, priorCashBeforeThisPayment, paymentAmount) {
    const D = Math.max(0, roundMoney(Number(depositLineAmount) || 0));
    const prior = Math.max(0, roundMoney(Number(priorCashBeforeThisPayment) || 0));
    const P = roundMoney(Number(paymentAmount) || 0);
    if (P <= MONEY_EPS) return { income: 0, liability: 0 };

    const depositFilledBefore = Math.min(prior, D);
    const depositFilledAfter = Math.min(roundMoney(prior + P), D);
    const liability = roundMoney(depositFilledAfter - depositFilledBefore);
    const income = roundMoney(Math.max(0, P - liability));
    return { income, liability };
}

const invoiceIncludeDetail = {
    customer: true,
    vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
    contract: true,
    creditNotes: true,
    payments: {
        orderBy: { paidAt: 'asc' },
        include: {
            advanceReceipt: {
                select: { id: true, receiptNo: true, ledgerPostedAt: true, reversedAt: true },
            },
        },
    },
};

exports.escapeHtml = escapeHtml;
exports.getCompanyProfileFromSettings = getCompanyProfileFromSettings;

exports.MONEY_EPS = MONEY_EPS;
exports.roundMoney = roundMoney;
exports.sumInvoicePayments = sumInvoicePayments;
exports.upfrontIncomeLiabilitySplit = upfrontIncomeLiabilitySplit;
exports.computeDepositFirstLedgerSplit = computeDepositFirstLedgerSplit;
exports.ensureUpfrontInvoiceInTx = ensureUpfrontInvoiceInTx;
exports.applyUpfrontPaymentInTx = applyUpfrontPaymentInTx;

/** Recompute ISSUED / PARTIALLY_PAID / PAID from payment rows after a delete or adjustment. */
async function refreshInvoicePaidStatusInTx(tx, invoiceId) {
    const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
    });
    if (!inv || inv.status === 'VOID') return;
    const total = Number(inv.total || 0);
    const paidSum = sumPaymentsTowardBalance(inv);
    let status = 'ISSUED';
    if (paidSum > MONEY_EPS && paidSum < total - MONEY_EPS) status = 'PARTIALLY_PAID';
    else if (paidSum >= total - MONEY_EPS) status = 'PAID';
    await tx.invoice.update({
        where: { id: invoiceId },
        data: {
            status,
            paidAt: status === 'PAID' ? new Date() : null,
            paidMethod: status === 'PAID' ? inv.paidMethod : null,
        },
    });
}

exports.refreshInvoicePaidStatusInTx = refreshInvoicePaidStatusInTx;

/** Native Driver version of status refresh. */
async function refreshInvoicePaidStatusNative(db, invoiceId) {
    const invoiceCollection = db.collection('Invoice');
    const paymentCollection = db.collection('InvoicePayment');

    const inv = await invoiceCollection.findOne({ _id: new ObjectId(invoiceId) });
    if (!inv || inv.status === 'VOID') return;

    const payments = await paymentCollection.find({ invoiceId: new ObjectId(invoiceId) }).toArray();
    const invWithPayments = { ...inv, payments };
    
    const total = Number(inv.total || 0);
    const paidSum = sumPaymentsTowardBalance(invWithPayments);
    
    let status = 'ISSUED';
    if (paidSum > MONEY_EPS && paidSum < total - MONEY_EPS) status = 'PARTIALLY_PAID';
    else if (paidSum >= total - MONEY_EPS) status = 'PAID';

    await invoiceCollection.updateOne(
        { _id: new ObjectId(invoiceId) },
        {
            $set: {
                status,
                paidAt: status === 'PAID' ? new Date() : null,
                paidMethod: status === 'PAID' ? inv.paidMethod : null,
                updatedAt: new Date()
            }
        }
    );
}
exports.refreshInvoicePaidStatusNative = refreshInvoicePaidStatusNative;

async function getCompanyProfileFromSettings() {
    const [nameSetting, addressSetting, logoSetting, contactSetting, whatsappSetting] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: 'company_name' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_address' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_logo' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_contact_number' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_whatsapp_number' } })
    ]);

    const name = nameSetting?.value && nameSetting.value !== 'false' ? (nameSetting.value || '') : '';
    const address = addressSetting?.value && addressSetting.value !== 'false' ? (addressSetting.value || '') : '';
    const logoUrl = logoSetting?.value && logoSetting.value !== 'false' ? (logoSetting.value || null) : null;
    const contactNumber = contactSetting?.value && contactSetting.value !== 'false' ? (contactSetting.value || '') : '';
    const whatsappNumber = whatsappSetting?.value && whatsappSetting.value !== 'false' ? (whatsappSetting.value || '') : '';

    return { name, address, logoUrl, contactNumber, whatsappNumber };
}

function buildInvoiceTableBodyRows(lines, amountCell, escapeHtml) {
    const arr = Array.isArray(lines) ? lines : [];
    const advanceRows = arr.filter((l) => l && l.code === 'ADVANCE_PAID');
    const beforeAdvance = arr.filter((l) => !l || l.code !== 'ADVANCE_PAID');
    if (advanceRows.length === 0) {
        return beforeAdvance
            .map(
                (l) => `
        <tr>
          <td>${escapeHtml(l.description || '')}</td>
          ${amountCell(l.amount)}
        </tr>`
            )
            .join('');
    }
    const subTotal = beforeAdvance.reduce((sum, l) => sum + Number(l?.amount || 0), 0);
    const beforeHtml = beforeAdvance
        .map(
            (l) => `
        <tr>
          <td>${escapeHtml(l.description || '')}</td>
          ${amountCell(l.amount)}
        </tr>`
        )
        .join('');
    const subRow = `
        <tr>
          <td style="font-weight:700;background:#f8fafc;">Sub total</td>
          <td style="text-align:right;font-weight:700;background:#f8fafc;">${escapeHtml(subTotal.toLocaleString())}</td>
        </tr>`;
    const advanceHtml = advanceRows
        .map(
            (l) => `
        <tr>
          <td>${escapeHtml(l.description || '')}</td>
          ${amountCell(l.amount)}
        </tr>`
        )
        .join('');
    return beforeHtml + subRow + advanceHtml;
}

function renderInvoiceHtml(invoice, company = { name: '', address: '', logoUrl: null, contactNumber: '', whatsappNumber: '' }) {
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const isReturn = String(invoice.type || '').toUpperCase() === 'RETURN';
    const total = Number(invoice.total || 0);
    const settlementLabel = isReturn
        ? (total < 0 ? 'Customer Need to Pay' : 'Company Have to Refund')
        : '';
    const displayTotal = isReturn ? Math.abs(total) : total;

    const customerName = invoice.customer?.name || invoice.customer?.email || '';
    const customerEmail = invoice.customer?.email || '';
    const vehiclePlate = invoice.vehicle?.licensePlate || '';
    const brandName = invoice.vehicle?.vehicleModel?.brand?.name || '';
    const modelName = invoice.vehicle?.vehicleModel?.name || '';
    const vehLabel = `${brandName} ${modelName}`.trim();
    const contractNo = invoice.contract?.contractNo || '-';

    const companyName = company?.name || '';
    const companyAddress = company?.address || '';
    const companyLogoUrl = company?.logoUrl || null;
    const companyContactNumber = company?.contactNumber || '';
    const companyWhatsAppNumber = company?.whatsappNumber || '';

    const showBrand = !!(companyName.trim() || companyLogoUrl);
    const logoImg = companyLogoUrl
        ? `<img class="doc-logo" src="${escapeHtml(companyLogoUrl)}" alt="" />`
        : '';
    const nameBlock = companyName.trim()
        ? `<div class="doc-company-name">${escapeHtml(companyName.trim())}</div>`
        : '';
    const addrBlock = companyAddress.trim()
        ? `<div class="doc-company-muted">${escapeHtml(companyAddress.trim()).replace(/\n/g, '<br/>')}</div>`
        : '';
    const chips = [];
    if (companyContactNumber.trim()) {
        chips.push(`<span class="doc-chip">Contact ${escapeHtml(companyContactNumber.trim())}</span>`);
    }
    if (companyWhatsAppNumber.trim()) {
        chips.push(`<span class="doc-chip">WhatsApp ${escapeHtml(companyWhatsAppNumber.trim())}</span>`);
    }
    const chipRow = chips.length ? `<div class="doc-chip-row">${chips.join('')}</div>` : '';
    const brandSection = showBrand
        ? `<div class="doc-brand-row">${logoImg}<div>${nameBlock}${addrBlock}${chipRow}</div></div>`
        : '';

    const amountCell = (amount) => {
        const a = Number(amount || 0);
        const display = isReturn ? (a < 0 ? Math.abs(a) : a) : a;
        return `<td style="text-align:right;">${escapeHtml(display.toLocaleString())}</td>`;
    };

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(invoice.invoiceNo || 'Invoice')}</title>
  <style>${DOCUMENT_PRINT_STYLES}</style>
</head>
<body>
  <div class="doc">
    <div class="doc-topbar"></div>
    <div class="doc-inner">
      ${brandSection}
      <div class="doc-headline">
        <div>
          <div class="doc-kind">Invoice</div>
          <div class="doc-main-id">${escapeHtml(invoice.invoiceNo || '')}</div>
          <div class="doc-meta">Issued <b>${invoice.createdAt ? escapeHtml(formatDateTime(invoice.createdAt)) : ''}</b> · Contract <b>${escapeHtml(contractNo)}</b></div>
        </div>
        <div class="doc-pill doc-pill-em">${escapeHtml(invoice.status || '')}</div>
      </div>

      ${settlementLabel ? `<div style="margin-bottom:16px;"><span class="doc-pill" style="background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent-soft);">${escapeHtml(settlementLabel)}</span></div>` : ''}

      <div class="doc-cards">
        <div class="doc-card">
          <div class="doc-card-label">Customer</div>
          <div class="doc-card-value">${escapeHtml(customerName)}</div>
          <div class="doc-card-sub">${escapeHtml(customerEmail)}</div>
        </div>
        <div class="doc-card">
          <div class="doc-card-label">Vehicle</div>
          <div class="doc-card-value">${escapeHtml(vehiclePlate)}</div>
          <div class="doc-card-sub">${escapeHtml(vehLabel)}</div>
        </div>
      </div>

      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Description</th><th style="text-align:right;">Amount (LKR)</th></tr>
          </thead>
          <tbody>
            ${buildInvoiceTableBodyRows(lines, amountCell, escapeHtml)}
          </tbody>
          <tfoot>
            <tr><td>Total</td><td>${escapeHtml(Number(displayTotal || 0).toLocaleString())}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="doc-foot">
        System-generated invoice — no signature required. 
        Use your browser print dialog and choose “Save as PDF” to download.
      </div>
      <div class="doc-brand-footer">
        Powered by <b>Rentix</b><br/>
        All rights reserved. Codebraze PVT LTD<br/>
        070 2 78 78 73 | www.codebraze.lk
      </div>
    </div>
  </div>
</body>
</html>`;
}

function daysBetween(pickupDate, dropoffDate) {
    const start = new Date(pickupDate);
    const end = new Date(dropoffDate);
    const ms = end.getTime() - start.getTime();
    const raw = Math.ceil(ms / (1000 * 60 * 60 * 24));
    return Math.max(1, raw || 1);
}

function parseTimeTo24h(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const t = timeStr.trim().toUpperCase();

    const m24 = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m24) {
        const h = Number(m24[1]);
        const min = Number(m24[2]);
        if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { h, min };
        return null;
    }

    const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(t);
    if (m12) {
        let h = Number(m12[1]);
        const min = Number(m12[2]);
        const ap = m12[3];
        if (h < 1 || h > 12 || min < 0 || min > 59) return null;
        if (ap === 'PM' && h !== 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        return { h, min };
    }

    return null;
}

function combineDateAndTime(dateVal, timeStr) {
    if (!dateVal) return null;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    const parsed = parseTimeTo24h(timeStr);
    if (!parsed) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), parsed.h, parsed.min, 0, 0);
}

/**
 * Same line math as createUpfrontInvoiceForContract (single source of truth).
 *
 * `opts.hasPostedAdvanceReceipt` controls the "Less: Advance Payment" deduction.
 * The advance amount on the contract is only a *plan* until an advance receipt
 * is posted (cash actually received) — deducting it from the invoice total
 * before that gives the customer credit for money we haven't collected and
 * makes the printed balance lie. So we only honour the deduction when a
 * non-reversed advance receipt exists; otherwise the invoice prints the gross
 * total with no advance line.
 */
function buildUpfrontLinesAndTotals(contract, opts = {}) {
    const hasPostedAdvanceReceipt = Boolean(opts.hasPostedAdvanceReceipt);
    const rate = Number(contract.appliedDailyRate) || 0;
    const scheduledDays = daysBetween(contract.pickupDate, contract.dropoffDate);
    const scheduledRentalCharge = rate * scheduledDays;

    let overtimeMinutesCeil = 0;
    let extraDays = 0;
    let extraHours = 0;
    let extraMins = 0;

    if (contract.status === 'COMPLETED') {
        const scheduledEnd = combineDateAndTime(contract.dropoffDate, contract.dropoffTime);
        const actualEnd = combineDateAndTime(contract.actualReturnDate, contract.actualReturnTime);
        if (scheduledEnd && actualEnd && actualEnd.getTime() > scheduledEnd.getTime()) {
            overtimeMinutesCeil = Math.ceil((actualEnd.getTime() - scheduledEnd.getTime()) / (1000 * 60));
            extraDays = Math.floor(overtimeMinutesCeil / 1440);
            const rem = overtimeMinutesCeil - extraDays * 1440;
            extraHours = Math.floor(rem / 60);
            extraMins = rem - extraHours * 60;
        }
    }

    const extraDayCharge = rate * extraDays;
    const remainderMinutes = overtimeMinutesCeil - extraDays * 1440;
    const extraTimeCharge = remainderMinutes > 0 ? rate * (remainderMinutes / 1440) : 0;

    const scheduledRentalOnly = scheduledRentalCharge;
    const securityDeposit = Number(contract.securityDeposit) || 0;
    const deliveryCharge = contract.isDelivery ? (Number(contract.deliveryCharge) || 0) : 0;
    const collectionCharge = contract.isCollection ? (Number(contract.collectionCharge) || 0) : 0;

    const lines = [
        {
            code: 'RENTAL',
            description: `Rental Charge (${scheduledDays} day(s) × ${rate} LKR)`,
            quantity: scheduledDays,
            unitPrice: rate,
            amount: scheduledRentalOnly,
        },
    ];

    if (extraDays > 0) {
        lines.push({
            code: 'RENTAL_EXTRA_DAYS',
            description: `Late Return Extra Days (${extraDays} day(s))`,
            quantity: extraDays,
            unitPrice: rate,
            amount: extraDayCharge,
        });
    }

    if (remainderMinutes > 0) {
        lines.push({
            code: 'RENTAL_EXTRA_TIME',
            description: `Late Return Extra Time (${extraHours}h ${extraMins}m)`,
            quantity: 1,
            unitPrice: rate,
            amount: extraTimeCharge,
        });
    }

    lines.push({
        code: 'DEPOSIT',
        description: 'Security Deposit (Refundable)',
        quantity: 1,
        unitPrice: securityDeposit,
        amount: securityDeposit,
    });

    const extraMileage = Number(contract.extraKmCost) || 0;
    if (extraMileage > 0) {
        lines.push({
            code: 'EXTRA_MILEAGE',
            description: 'Extra Mileage Charge',
            quantity: 1,
            unitPrice: extraMileage,
            amount: extraMileage,
        });
    }

    const damageCharge = Number(contract.damageCharge) || 0;
    if (damageCharge > 0) {
        lines.push({
            code: 'DAMAGE_CHARGE',
            description: 'Damage Charge',
            quantity: 1,
            unitPrice: damageCharge,
            amount: damageCharge,
        });
    }

    const otherChargeAmount = Number(contract.otherChargeAmount) || 0;
    if (otherChargeAmount > 0) {
        const otherDesc = contract.otherChargeDescription || 'Other Charges';
        lines.push({
            code: 'OTHER_CHARGE',
            description: `Other Charge (${otherDesc})`,
            quantity: 1,
            unitPrice: otherChargeAmount,
            amount: otherChargeAmount,
        });
    }

    if (deliveryCharge > 0 || contract.isDelivery) {
        lines.push({
            code: 'DELIVERY',
            description: 'Delivery Charge',
            quantity: 1,
            unitPrice: deliveryCharge,
            amount: deliveryCharge,
        });
    }
    if (collectionCharge > 0 || contract.isCollection) {
        lines.push({
            code: 'COLLECTION',
            description: 'Collection Charge',
            quantity: 1,
            unitPrice: collectionCharge,
            amount: collectionCharge,
        });
    }

    const subtotalBeforeAdvance = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const advancePaidRaw = Math.max(0, Number(contract.advancePaymentAmount || 0));
    const advancePaid = hasPostedAdvanceReceipt
        ? Math.min(advancePaidRaw, Math.max(0, subtotalBeforeAdvance))
        : 0;
    if (advancePaid > 0) {
        const paidDateText = contract.advancePaymentDate
            ? new Date(contract.advancePaymentDate).toISOString().slice(0, 10)
            : '';
        lines.push({
            code: 'ADVANCE_PAID',
            description: `Less: Advance Payment${paidDateText ? ` (${paidDateText})` : ''}`,
            quantity: 1,
            unitPrice: -advancePaid,
            amount: -advancePaid,
        });
    }
    const subtotal = subtotalBeforeAdvance - advancePaid;
    const total = subtotal;
    return { lines, subtotal, total };
}

/**
 * Create or refresh non-void UPFRONT invoice inside an existing transaction. No customer email.
 */
async function ensureUpfrontInvoiceInTx(tx, contractId, contract, currency = 'LKR') {
    const existing = await tx.invoice.findFirst({
        where: { contractId, type: 'UPFRONT', NOT: { status: 'VOID' } },
        include: invoiceIncludeDetail,
    });
    // Only the bookkeeping receipt counts — typed-in `advancePaymentAmount` on
    // the contract is just a plan until cash is collected via an advance receipt.
    const postedAdvanceReceipt = await tx.advanceReceipt.findFirst({
        where: {
            contractId,
            ledgerPostedAt: { not: null },
            reversedAt: null,
        },
        select: { id: true },
    });
    const { lines, subtotal, total } = buildUpfrontLinesAndTotals(contract, {
        hasPostedAdvanceReceipt: Boolean(postedAdvanceReceipt),
    });
    if (existing) {
        const updated = await tx.invoice.update({
            where: { id: existing.id },
            data: {
                subtotal,
                total,
                lines,
                status: existing.status,
            },
        });
        return tx.invoice.findUnique({
            where: { id: updated.id },
            include: invoiceIncludeDetail,
        });
    }

    const setting = await tx.systemSetting.findUnique({ where: { key: INVOICE_SEQ_KEY } });
    const current = setting ? Number(setting.value) || 0 : 0;
    const next = current + 1;

    if (setting) {
        await tx.systemSetting.update({
            where: { key: INVOICE_SEQ_KEY },
            data: { value: String(next) },
        });
    } else {
        await tx.systemSetting.create({
            data: { key: INVOICE_SEQ_KEY, value: String(next) },
        });
    }

    const invoiceNo = buildInvoiceNo(next, new Date());
    return tx.invoice.create({
        data: {
            invoiceNo,
            sequence: next,
            type: 'UPFRONT',
            currency: currency || 'LKR',
            subtotal,
            total,
            status: 'ISSUED',
            lines,
            contract: { connect: { id: contractId } },
            customer: { connect: { id: contract.customerId } },
            vehicle: { connect: { id: contract.vehicleId } },
        },
        include: invoiceIncludeDetail,
    });
}
exports.ensureUpfrontInvoiceInTx = ensureUpfrontInvoiceInTx;

/** Native Driver version of upfront invoice preparation. */
async function ensureUpfrontInvoiceNative(db, contractId, contract, currency = 'LKR') {
    const invoiceCollection = db.collection('Invoice');

    const existing = await invoiceCollection.findOne({ 
        contractId: new ObjectId(contractId), 
        type: 'UPFRONT', 
        status: { $ne: 'VOID' } 
    });

    const advanceReceiptCollection = db.collection('AdvanceReceipt');
    const postedAdvanceReceipt = await advanceReceiptCollection.findOne({
        contractId: new ObjectId(contractId),
        ledgerPostedAt: { $ne: null },
        reversedAt: null
    });

    const { lines, subtotal, total } = buildUpfrontLinesAndTotals(contract, {
        hasPostedAdvanceReceipt: Boolean(postedAdvanceReceipt),
    });

    if (existing) {
        await invoiceCollection.updateOne(
            { _id: existing._id },
            {
                $set: {
                    subtotal,
                    total,
                    lines,
                    updatedAt: new Date()
                }
            }
        );
        return { ...existing, subtotal, total, lines };
    }

    // Atomic sequence update via unified Prisma utility
    const next = await getNextSequenceValue(INVOICE_SEQ_KEY);
    const invoiceNo = buildInvoiceNo(next, new Date());

    const newInvoice = {
        invoiceNo,
        sequence: next,
        type: 'UPFRONT',
        currency: currency || 'LKR',
        subtotal,
        total,
        status: 'ISSUED',
        lines,
        contractId: new ObjectId(contractId),
        customerId: new ObjectId(contract.customerId),
        vehicleId: new ObjectId(contract.vehicleId),
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const insertResult = await invoiceCollection.insertOne(newInvoice);
    return { ...newInvoice, id: insertResult.insertedId.toString() };
}
exports.ensureUpfrontInvoiceNative = ensureUpfrontInvoiceNative;

exports.getInvoiceByContract = async (req, res) => {
    try {
        const { contractId } = req.params;
        const type = (req.query?.type ? String(req.query.type) : 'UPFRONT').toUpperCase();
        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            select: { upfrontReleased: true },
        });
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        const invoice = await prisma.invoice.findFirst({
            where: { contractId, type },
            include: invoiceIncludeDetail
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        if (type === 'UPFRONT' && contract.upfrontReleased === false) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const resObj = {
            ...invoice,
            shareUrl: buildInvoiceShareLink(req, invoice.id)
        };
        res.json(resObj);
    } catch (error) {
        console.error('Get Invoice By Contract Error:', error);
        res.status(500).json({ message: 'Failed to fetch invoice' });
    }
};

exports.getInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: invoiceIncludeDetail
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        const resObj = {
            ...invoice,
            shareUrl: buildInvoiceShareLink(req, invoice.id)
        };
        res.json(resObj);
    } catch (error) {
        console.error('Get Invoice Error:', error);
        res.status(500).json({ message: 'Failed to fetch invoice' });
    }
};

exports.getSharedInvoice = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { token } = req.query;
        if (!token) return res.status(401).send('Missing token');

        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).send('Invalid or expired token');
        }

        if (!payload?.invoiceId || payload.invoiceId !== invoiceId) return res.status(403).send('Forbidden');

        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: invoiceIncludeDetail
        });

        if (!invoice) return res.status(404).send('Invoice not found');
        const company = await getCompanyProfileFromSettings();
        res.type('text/html').send(renderInvoiceHtml(invoice, company));
    } catch (error) {
        console.error('Get Shared Invoice Error:', error);
        res.status(500).send('Failed to load invoice');
    }
};

exports.getInvoiceShareLink = async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await prisma.invoice.findUnique({ where: { id } });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        const shareUrl = buildInvoiceShareLink(req, invoice.id);
        res.json({ shareUrl });
    } catch (error) {
        console.error('Get Invoice Share Link Error:', error);
        res.status(500).json({ message: 'Failed to generate share link' });
    }
};

exports.listInvoices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const requestedLimit = parseInt(req.query.limit) || 20;
        const limit = Math.min(requestedLimit, 100);
        const skip = (page - 1) * limit;
        const { search, status, from, to } = req.query;

        const where = {};

        if (status && status !== 'ALL') {
            where.status = status;
        }

        if (from || to) {
            where.createdAt = {};
            if (from) where.createdAt.gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                where.createdAt.lt = toDate;
            }
        }

        if (search) {
            const s = String(search).trim();
            where.OR = [
                { invoiceNo: { contains: s, mode: 'insensitive' } },
                { customer: { name: { contains: s, mode: 'insensitive' } } },
                { vehicle: { licensePlate: { contains: s, mode: 'insensitive' } } },
                { contract: { contractNo: { contains: s, mode: 'insensitive' } } }
            ];
        }

        const [invoices, totalCount] = await Promise.all([
            prisma.invoice.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: invoiceIncludeDetail
            }),
            prisma.invoice.count({ where })
        ]);

        res.json({
            data: invoices,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('List Invoices Error:', error);
        res.status(500).json({ message: 'Failed to fetch invoices' });
    }
};

const createUpfrontSchema = z.object({
    currency: z.string().optional(),
});

const markPaidSchema = z.object({
    method: z.string().optional(),
});

const recordPaymentSchema = z.object({
    amount: z.union([z.number(), z.string()]),
    method: z.string().optional(),
});

async function loadInvoiceDetail(id) {
    return prisma.invoice.findUnique({
        where: { id },
        include: invoiceIncludeDetail
    });
}

/** Reload invoice scalars — Mongo documents missing FK fields break Prisma connect(). */
async function loadInvoiceLedgerParents(tx, invoiceId) {
    return tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            invoiceNo: true,
            type: true,
            currency: true,
            contractId: true,
            customerId: true,
            vehicleId: true,
            lines: true,
            total: true,
            paidMethod: true,
        },
    });
}

/** UPFRONT / non-RETURN: record one payment and post P&L using deposit-first allocation (see computeDepositFirstLedgerSplit). */
async function applyUpfrontPaymentInTx(tx, invoice, paymentAmount, method, opts = {}) {
    const { advanceReceiptId } = opts;
    const amt = roundMoney(paymentAmount);
    if (amt <= 0) throw new Error('Payment amount must be positive');

    const existingPayments = await tx.invoicePayment.findMany({
        where: { invoiceId: invoice.id },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    });
    const priorCash = existingPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

    await tx.invoicePayment.create({
        data: {
            amount: amt,
            method: method || null,
            paidAt: new Date(),
            invoice: { connect: { id: invoice.id } },
            ...(advanceReceiptId
                ? { advanceReceipt: { connect: { id: advanceReceiptId } } }
                : {}),
        },
    });

    const base = await loadInvoiceLedgerParents(tx, invoice.id);
    if (!base) throw new Error('Invoice not found after recording payment');
    const contractId = base.contractId || invoice.contractId || invoice.contract?.id;
    const customerId = base.customerId || invoice.customerId || invoice.customer?.id;
    const vehicleId = base.vehicleId || invoice.vehicleId || invoice.vehicle?.id;
    if (!contractId || !customerId || !vehicleId) {
        throw new Error(
            'Invoice is missing contract, customer, or vehicle link. Save the contract with a customer and vehicle, then try again.',
        );
    }

    const lines = Array.isArray(base.lines) ? base.lines : [];
    const depositLine = lines.find(l => l?.code === 'DEPOSIT');
    const deposit = Number(depositLine?.amount || 0);
    const netTotal = Number(base.total ?? 0);

    const { income, liability } = computeDepositFirstLedgerSplit(deposit, priorCash, amt);
    const incomeAmt = roundMoney(income);
    const liabilityAmt = roundMoney(liability);
    const cur = base.currency || invoice.currency || 'LKR';
    const invNo = base.invoiceNo || invoice.invoiceNo || '';

    if (incomeAmt > MONEY_EPS && Number.isFinite(incomeAmt)) {
        await tx.ledgerEntry.create({
            data: {
                type: 'INCOME',
                amount: incomeAmt,
                currency: cur,
                description: `Invoice ${invNo} rental income (deposit-first cash allocation)`,
                invoice: { connect: { id: base.id } },
                contract: { connect: { id: contractId } },
                customer: { connect: { id: customerId } },
                vehicle: { connect: { id: vehicleId } },
            },
        });
    }

    if (Math.abs(liabilityAmt) > MONEY_EPS && Number.isFinite(liabilityAmt)) {
        await tx.ledgerEntry.create({
            data: {
                type: 'LIABILITY',
                amount: liabilityAmt,
                currency: cur,
                description: `Security deposit liability for ${invNo} (deposit-first)`,
                invoice: { connect: { id: base.id } },
                contract: { connect: { id: contractId } },
                customer: { connect: { id: customerId } },
                vehicle: { connect: { id: vehicleId } },
            },
        });
    }

    const payments = await tx.invoicePayment.findMany({ where: { invoiceId: invoice.id } });
    const paidSum = sumPaymentsTowardBalance({
        type: base.type || invoice.type,
        lines: base.lines,
        payments,
    });
    const isFullyPaid = paidSum >= netTotal - MONEY_EPS;

    await tx.invoice.update({
        where: { id: invoice.id },
        data: {
            status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: isFullyPaid ? new Date() : null,
            paidMethod: isFullyPaid ? (method || invoice.paidMethod || null) : (invoice.paidMethod || null),
        }
    });
}
exports.applyUpfrontPaymentInTx = applyUpfrontPaymentInTx;

/** Native Driver version of payment application. */
async function applyUpfrontPaymentNative(db, invoice, paymentAmount, method, opts = {}) {
    const { advanceReceiptId } = opts;
    const amt = roundMoney(paymentAmount);
    if (amt <= 0) throw new Error('Payment amount must be positive');

    const paymentCollection = db.collection('InvoicePayment');
    const ledgerCollection = db.collection('LedgerEntry');
    const invoiceCollection = db.collection('Invoice');

    const invoiceId = invoice.id || invoice._id.toString();

    const existingPayments = await paymentCollection.find({ 
        invoiceId: new ObjectId(invoiceId) 
    }).sort({ paidAt: 1, _id: 1 }).toArray();
    
    const priorCash = existingPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

    const paymentDoc = {
        amount: amt,
        method: method || null,
        paidAt: new Date(),
        invoiceId: new ObjectId(invoiceId),
        advanceReceiptId: advanceReceiptId ? new ObjectId(advanceReceiptId) : null,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    await paymentCollection.insertOne(paymentDoc);

    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const depositLine = lines.find(l => l?.code === 'DEPOSIT');
    const deposit = Number(depositLine?.amount || 0);

    const { income, liability } = computeDepositFirstLedgerSplit(deposit, priorCash, amt);
    const incomeAmt = roundMoney(income);
    const liabilityAmt = roundMoney(liability);
    const cur = invoice.currency || 'LKR';
    const invNo = invoice.invoiceNo || '';

    const contractId = invoice.contractId;
    const customerId = invoice.customerId;
    const vehicleId = invoice.vehicleId;

    if (incomeAmt > MONEY_EPS && Number.isFinite(incomeAmt)) {
        await ledgerCollection.insertOne({
            type: 'INCOME',
            amount: incomeAmt,
            currency: cur,
            description: `Invoice ${invNo} rental income (deposit-first cash allocation)`,
            invoiceId: new ObjectId(invoiceId),
            contractId: new ObjectId(contractId),
            customerId: new ObjectId(customerId),
            vehicleId: new ObjectId(vehicleId),
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    if (Math.abs(liabilityAmt) > MONEY_EPS && Number.isFinite(liabilityAmt)) {
        await ledgerCollection.insertOne({
            type: 'LIABILITY',
            amount: liabilityAmt,
            currency: cur,
            description: `Security deposit liability for ${invNo} (deposit-first)`,
            invoiceId: new ObjectId(invoiceId),
            contractId: new ObjectId(contractId),
            customerId: new ObjectId(customerId),
            vehicleId: new ObjectId(vehicleId),
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    await refreshInvoicePaidStatusNative(db, invoiceId);
}
exports.applyUpfrontPaymentNative = applyUpfrontPaymentNative;

/** RETURN settlement: single ledger posting (no partials). */
async function applyReturnSettlementInTx(tx, invoice, method) {
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const depositLine = lines.find(l => l?.code === 'DEPOSIT');
    const deposit = Number(depositLine?.amount || 0);

    const deductionsTotal = lines
        .filter(l => l && l.code !== 'DEPOSIT' && l.code !== 'NET')
        .reduce((sum, l) => sum + Math.max(0, -Number(l.amount || 0)), 0);

    const incomeAmount = deductionsTotal;
    const liabilityDelta = deposit > 0 ? -Math.abs(deposit) : 0;

    const settlementAmount = roundMoney(Math.abs(Number(invoice.total || 0)));

    await tx.invoicePayment.create({
        data: {
            amount: settlementAmount,
            method: method || null,
            paidAt: new Date(),
            invoice: { connect: { id: invoice.id } },
        }
    });

    if (incomeAmount > MONEY_EPS) {
        await tx.ledgerEntry.create({
            data: {
                type: 'INCOME',
                amount: incomeAmount,
                currency: invoice.currency || 'LKR',
                description: `Return settlement income for ${invoice.invoiceNo}`,
                invoice: { connect: { id: invoice.id } },
                contract: { connect: { id: invoice.contractId } },
                customer: { connect: { id: invoice.customerId } },
                vehicle: { connect: { id: invoice.vehicleId } },
            }
        });
    }

    if (Math.abs(liabilityDelta) > MONEY_EPS) {
        await tx.ledgerEntry.create({
            data: {
                type: 'LIABILITY',
                amount: liabilityDelta,
                currency: invoice.currency || 'LKR',
                description: `Security deposit settlement for ${invoice.invoiceNo}`,
                invoice: { connect: { id: invoice.id } },
                contract: { connect: { id: invoice.contractId } },
                customer: { connect: { id: invoice.customerId } },
                vehicle: { connect: { id: invoice.vehicleId } },
            }
        });
    }

    await tx.invoice.update({
        where: { id: invoice.id },
        data: {
            status: 'PAID',
            paidAt: new Date(),
            paidMethod: method || invoice.paidMethod || null
        }
    });
}

/** Native version of return settlement — avoids P2031 on standalone MongoDB */
async function applyReturnSettlementNative(db, invoice, method) {
    const invoiceId = invoice.id;
    const paymentCollection = db.collection('InvoicePayment');
    const ledgerCollection = db.collection('LedgerEntry');
    const invoiceCollection = db.collection('Invoice');

    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const depositLine = lines.find(l => l?.code === 'DEPOSIT');
    const deposit = Number(depositLine?.amount || 0);

    const deductionsTotal = lines
        .filter(l => l && l.code !== 'DEPOSIT' && l.code !== 'NET')
        .reduce((sum, l) => sum + Math.max(0, -Number(l.amount || 0)), 0);

    const incomeAmount = deductionsTotal;
    const liabilityDelta = deposit > 0 ? -Math.abs(deposit) : 0;

    const settlementAmount = roundMoney(Math.abs(Number(invoice.total || 0)));

    // Record payment
    await paymentCollection.insertOne({
        amount: settlementAmount,
        method: method || null,
        paidAt: new Date(),
        invoiceId: new ObjectId(invoiceId),
        createdAt: new Date(),
        updatedAt: new Date()
    });

    const cur = invoice.currency || 'LKR';
    const invNo = invoice.invoiceNo || '';

    // Record Income Ledger
    if (incomeAmount > MONEY_EPS) {
        await ledgerCollection.insertOne({
            type: 'INCOME',
            amount: incomeAmount,
            currency: cur,
            description: `Return settlement income for ${invNo}`,
            invoiceId: new ObjectId(invoiceId),
            contractId: new ObjectId(invoice.contractId),
            customerId: new ObjectId(invoice.customerId),
            vehicleId: new ObjectId(invoice.vehicleId),
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    // Record Liability Ledger (release deposit)
    if (Math.abs(liabilityDelta) > MONEY_EPS) {
        await ledgerCollection.insertOne({
            type: 'LIABILITY',
            amount: liabilityDelta,
            currency: cur,
            description: `Security deposit settlement for ${invNo}`,
            invoiceId: new ObjectId(invoiceId),
            contractId: new ObjectId(invoice.contractId),
            customerId: new ObjectId(invoice.customerId),
            vehicleId: new ObjectId(invoice.vehicleId),
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    // Update invoice status
    await invoiceCollection.updateOne(
        { _id: new ObjectId(invoiceId) },
        {
            $set: {
                status: 'PAID',
                paidAt: new Date(),
                paidMethod: method || invoice.paidMethod || null,
                updatedAt: new Date()
            }
        }
    );
}

exports.recordInvoicePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const body = recordPaymentSchema.parse(req.body || {});
        const amount = roundMoney(Number(body.amount));
        const { method } = body;

        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: invoiceIncludeDetail
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (invoice.status === 'VOID') return res.status(400).json({ message: 'Invoice is void' });
        if (invoice.status === 'PAID') return res.status(400).json({ message: 'Invoice is already fully paid' });

        const invoiceType = String(invoice.type || '').toUpperCase();
        if (invoiceType === 'RETURN') {
            return res.status(400).json({ message: 'Return invoices must be settled with Mark as paid in full' });
        }

        const total = Number(invoice.total || 0);
        const paidSum = sumPaymentsTowardBalance(invoice);
        const remaining = roundMoney(total - paidSum);
        if (remaining <= MONEY_EPS) {
            return res.status(400).json({ message: 'No balance remaining' });
        }
        if (amount > remaining + MONEY_EPS) {
            return res.status(400).json({ message: `Amount exceeds balance due (${remaining})` });
        }

        // Native driver setup — avoids P2031 on standalone MongoDB
        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        await applyUpfrontPaymentNative(db, invoice, amount, method, {});

        const full = await loadInvoiceDetail(id);
        res.json(full);
    } catch (error) {
        console.error('Record Invoice Payment Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to record payment' });
    }
};

exports.markInvoicePaid = async (req, res) => {
    try {
        const { id } = req.params;
        const { method } = markPaidSchema.parse(req.body || {});

        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: invoiceIncludeDetail
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (invoice.status === 'PAID') return res.json(await loadInvoiceDetail(id));
        if (invoice.status === 'VOID') return res.status(400).json({ message: 'Invoice is void' });

        const invoiceType = String(invoice.type || '').toUpperCase();

        // Native driver setup — avoids P2031 on standalone MongoDB
        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        if (invoiceType === 'RETURN') {
            if (invoice.payments?.length) {
                return res.status(400).json({ message: 'Return invoice already has payment records' });
            }
            await applyReturnSettlementNative(db, invoice, method);
            return res.json(await loadInvoiceDetail(id));
        }

        const total = Number(invoice.total || 0);
        const paidSum = sumPaymentsTowardBalance(invoice);
        const remaining = roundMoney(total - paidSum);

        if (remaining <= MONEY_EPS) {
            await db.collection('Invoice').updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status: 'PAID',
                        paidAt: new Date(),
                        paidMethod: method || invoice.paidMethod || null,
                        updatedAt: new Date()
                    }
                }
            );
        } else {
            await applyUpfrontPaymentNative(db, invoice, remaining, method, {});
        }

        res.json(await loadInvoiceDetail(id));
    } catch (error) {
        console.error('Mark Invoice Paid Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to mark invoice as paid' });
    }
};

const creditNoteSchema = z.object({
    reason: z.string().optional(),
});

exports.createCreditNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = creditNoteSchema.parse(req.body || {});

        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: { creditNotes: true }
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (invoice.creditNotes?.length) {
            return res.status(400).json({ message: 'Credit note already exists for this invoice' });
        }
        if (invoice.status !== 'PAID') {
            return res.status(400).json({ message: 'Only PAID invoices can be credited' });
        }

        // Native driver setup — avoids P2031 on standalone MongoDB
        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);
        const creditNoteCollection = db.collection('CreditNote');
        const ledgerCollection = db.collection('LedgerEntry');
        const invoiceCollection = db.collection('Invoice');

        // 1. Allocate sequence number via unified Prisma utility
        const next = await getNextSequenceValue(CREDIT_NOTE_SEQ_KEY);
        const creditNoteNo = buildCreditNoteNo(next, new Date());

        // 2. Insert Credit Note
        const cnResult = await creditNoteCollection.insertOne({
            creditNoteNo,
            sequence: next,
            reason: reason || null,
            invoiceId: new ObjectId(invoice.id),
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // 3. Reverse ledger impact by adding negative entries
        const entries = await prisma.ledgerEntry.findMany({ where: { invoiceId: invoice.id } });
        for (const e of entries) {
            await ledgerCollection.insertOne({
                type: e.type,
                amount: -Math.abs(e.amount),
                currency: e.currency,
                description: `Credit note ${creditNoteNo} reversal for ${invoice.invoiceNo}`,
                invoiceId: new ObjectId(invoice.id),
                contractId: e.contractId ? new ObjectId(e.contractId) : null,
                customerId: e.customerId ? new ObjectId(e.customerId) : null,
                vehicleId: e.vehicleId ? new ObjectId(e.vehicleId) : null,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        // 4. Update invoice status to VOID
        await invoiceCollection.updateOne(
            { _id: new ObjectId(invoice.id) },
            { $set: { status: 'VOID', updatedAt: new Date() } }
        );

        const created = await prisma.creditNote.findUnique({ where: { id: cnResult.insertedId.toString() } });

        res.status(201).json(created);
    } catch (error) {
        console.error('Create Credit Note Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to create credit note' });
    }
};

exports.createUpfrontInvoiceForContract = async (req, res) => {
    try {
        const { contractId } = req.params;
        const { currency } = createUpfrontSchema.parse(req.body || {});

        const existing = await prisma.invoice.findFirst({ where: { contractId, type: 'UPFRONT' } });
        if (existing && existing.status === 'VOID') {
            const mClientVoid = await getMongoClient();
            const dbNameVoid = process.env.DATABASE_URL.split('/').pop().split('?')[0];
            const dbVoid = mClientVoid.db(dbNameVoid);
            await dbVoid.collection('Contract').updateOne(
                { _id: new ObjectId(contractId) },
                { $set: { upfrontReleased: true, updatedAt: new Date() } }
            );
            const invoice = await prisma.invoice.findUnique({
                where: { id: existing.id },
                include: invoiceIncludeDetail
            });
            (async () => {
                try {
                    const customerEmail = invoice.customer?.email;
                    if (!customerEmail) return;
                    const invoiceLink = buildInvoiceShareLink(req, invoice.id);
                    await sendTemplateEmail('INVOICE_SENT', customerEmail, {
                        customer_name: invoice.customer?.name || invoice.customer?.email || '',
                        invoice_no: invoice.invoiceNo,
                        contract_no: invoice.contract?.contractNo || '',
                        invoice_total: invoice.total,
                        invoice_link: invoiceLink,
                    });
                } catch (e) {
                    console.error('Failed to send upfront invoice email:', e?.message || e);
                }
            })();

            const resObj = {
                ...invoice,
                shareUrl: buildInvoiceShareLink(req, invoice.id)
            };
            return res.status(200).json(resObj);
        }

        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } }
            }
        });
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        const inv = await ensureUpfrontInvoiceNative(db, contractId, contract, currency || 'LKR');

        await db.collection('Contract').updateOne(
            { _id: new ObjectId(contractId) },
            { $set: { upfrontReleased: true, updatedAt: new Date() } }
        );

        const resolvedId = inv.id || (inv._id ? inv._id.toString() : null);
        if (!resolvedId) throw new Error('Invoice creation failed — no ID returned');

        const invoice = await prisma.invoice.findUnique({
            where: { id: resolvedId },
            include: invoiceIncludeDetail
        });

        (async () => {
            try {
                const customerEmail = invoice?.customer?.email;
                if (!customerEmail) return;
                const invoiceLink = buildInvoiceShareLink(req, invoice.id);
                await sendTemplateEmail('INVOICE_SENT', customerEmail, {
                    customer_name: invoice.customer?.name || invoice.customer?.email || '',
                    invoice_no: invoice.invoiceNo,
                    contract_no: invoice.contract?.contractNo || '',
                    invoice_total: invoice.total,
                    invoice_link: invoiceLink,
                });
            } catch (e) {
                console.error('Failed to send upfront invoice email:', e?.message || e);
            }
        })();

        const resObj = {
            ...invoice,
            shareUrl: buildInvoiceShareLink(req, invoice.id)
        };
        res.status(201).json(resObj);
    } catch (error) {
        console.error('Create Upfront Invoice Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to create invoice' });
    }
};

function safeNumber(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
}

function computeLateExtrasForContract(contract, extraData = {}) {
    const rate = safeNumber(contract.appliedDailyRate);
    let extraDayCharge = 0;
    let extraTimeRemainderCharge = 0;
    let extraKmCost = 0;

    const scheduledEnd = combineDateAndTime(contract.dropoffDate, contract.dropoffTime);
    const actualEnd = combineDateAndTime(contract.actualReturnDate, contract.actualReturnTime);
    
    // 1. Calculate Time Extras (only if late)
    if (scheduledEnd && actualEnd && actualEnd.getTime() > scheduledEnd.getTime()) {
        const overtimeMinutesCeil = Math.ceil((actualEnd.getTime() - scheduledEnd.getTime()) / (1000 * 60));
        const extraDays = Math.floor(overtimeMinutesCeil / 1440);
        const remMinutes = overtimeMinutesCeil - extraDays * 1440;

        extraDayCharge = rate * extraDays;
        extraTimeRemainderCharge = remMinutes > 0 ? rate * (remMinutes / 1440) : 0;
        
        // Time coverage adjustments for mileage
        const dailyKm = safeNumber(contract.dailyKmLimit);
        const dailyCoverageKm = Math.round(dailyKm * (overtimeMinutesCeil / 1440));
        // We add these to allocatedKm effectively
    }

    // 2. Calculate Mileage Extras (always if over limit)
    const dailyKm = safeNumber(contract.dailyKmLimit);
    const allocated = safeNumber(contract.allocatedKm);
    
    // Calculate total allowed KM including any overtime coverage
    let overtimeCoverageKm = 0;
    if (scheduledEnd && actualEnd && actualEnd.getTime() > scheduledEnd.getTime()) {
        const overtimeMinutes = (actualEnd.getTime() - scheduledEnd.getTime()) / (1000 * 60);
        overtimeCoverageKm = Math.round(dailyKm * (overtimeMinutes / 1440));
    }
    
    const totalAllowedKm = allocated + overtimeCoverageKm;

    const startOdo = safeNumber(contract.startOdometer);
    const endOdo = safeNumber(extraData.endOdometer ?? contract.endOdometer);
    const usedKm = endOdo > 0 ? Math.max(0, endOdo - startOdo) : 0;

    const remainingExtraKm = Math.max(0, usedKm - totalAllowedKm);
    const perKmRate = safeNumber(contract.extraMileageCharge);
    extraKmCost = remainingExtraKm * perKmRate;

    return { extraDayCharge, extraTimeRemainderCharge, extraKmCost };
}

exports.createReturnInvoiceForContract = async (req, res) => {
    try {
        const { contractId } = req.params;
        const { currency, ...overrides } = req.body || {};

        const existing = await prisma.invoice.findFirst({ where: { contractId, type: 'RETURN' } });
        if (existing && existing.status === 'PAID') {
            const invoice = await prisma.invoice.findUnique({
                where: { id: existing.id },
                include: invoiceIncludeDetail
            });
            // Send invoice link to customer (non-blocking).
            (async () => {
                try {
                    const customerEmail = invoice.customer?.email;
                    if (!customerEmail) return;
                    const invoiceLink = buildInvoiceShareLink(req, invoice.id);
                    await sendTemplateEmail('INVOICE_SENT', customerEmail, {
                        customer_name: invoice.customer?.name || invoice.customer?.email || '',
                        invoice_no: invoice.invoiceNo,
                        contract_no: invoice.contract?.contractNo || '',
                        invoice_total: invoice.total,
                        invoice_link: invoiceLink,
                    });
                } catch (e) {
                    console.error('Failed to send return invoice email:', e?.message || e);
                }
            })();

            const resObj = {
                ...invoice,
                shareUrl: buildInvoiceShareLink(req, invoice.id)
            };
            return res.status(200).json(resObj);
        }

        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } }
            }
        });
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        // Merge overrides from frontend (Live Data Sync)
        if (overrides.actualReturnDate) {
            contract.actualReturnDate = new Date(overrides.actualReturnDate);
        }
        if (overrides.actualReturnTime) contract.actualReturnTime = overrides.actualReturnTime;
        if (overrides.endOdometer !== undefined) contract.endOdometer = safeNumber(overrides.endOdometer);
        if (overrides.damageCharge !== undefined) contract.damageCharge = safeNumber(overrides.damageCharge);
        if (overrides.otherChargeAmount !== undefined) contract.otherChargeAmount = safeNumber(overrides.otherChargeAmount);
        if (overrides.otherChargeDescription !== undefined) contract.otherChargeDescription = overrides.otherChargeDescription;
        if (overrides.isCollection !== undefined) contract.isCollection = !!overrides.isCollection;
        if (overrides.collectionCharge !== undefined) contract.collectionCharge = safeNumber(overrides.collectionCharge);
        if (overrides.securityDeposit !== undefined) contract.securityDeposit = safeNumber(overrides.securityDeposit);
        
        // Smart fallback for extra mileage charge
        const extraMileageRate = safeNumber(overrides.extraMileageCharge || contract.extraMileageCharge);
        contract.extraMileageCharge = extraMileageRate > 0 ? extraMileageRate : safeNumber(contract.vehicle?.extraKmCharge);

        // SYNC: Update the database with these live values so the contract record is accurate
        try {
            await prisma.contract.update({
                where: { id: contractId },
                data: {
                    actualReturnDate: contract.actualReturnDate,
                    actualReturnTime: contract.actualReturnTime,
                    endOdometer: contract.endOdometer,
                    damageCharge: contract.damageCharge,
                    otherChargeAmount: contract.otherChargeAmount,
                    otherChargeDescription: contract.otherChargeDescription,
                    isCollection: contract.isCollection,
                    collectionCharge: contract.collectionCharge,
                    securityDeposit: contract.securityDeposit,
                    extraMileageCharge: contract.extraMileageCharge
                }
            });
        } catch (updateError) {
            console.error('Failed to sync contract data during invoice creation:', updateError);
            // We continue even if update fails, but log it.
        }

        // We only generate return invoice when return details exist.
        if (!contract.actualReturnDate || !contract.actualReturnTime) {
            return res.status(400).json({ message: 'Actual return date/time is required to generate return invoice' });
        }

        const { extraDayCharge, extraTimeRemainderCharge, extraKmCost } = computeLateExtrasForContract(contract);
        const damageCharge = safeNumber(contract.damageCharge);
        const otherChargeAmount = safeNumber(contract.otherChargeAmount);
        const otherChargeDescription = contract.otherChargeDescription || '';
        const collectionCharge = safeNumber(contract.isCollection ? contract.collectionCharge : 0);

        const deposit = safeNumber(contract.securityDeposit);

        // Settlement style:
        //  - Deposit is shown as positive
        //  - Deductions are shown as negative line items
        //  - Total is the net settlement: (deposit - deductionsTotal)
        const deductions = [];

        if (extraDayCharge > 0) deductions.push({ code: 'RENTAL_EXTRA_DAYS', description: 'Deduction - Late Return Extra Days', amount: extraDayCharge });
        if (extraTimeRemainderCharge > 0) deductions.push({ code: 'RENTAL_EXTRA_TIME', description: 'Deduction - Late Return Extra Time', amount: extraTimeRemainderCharge });
        if (extraKmCost > 0) deductions.push({ code: 'EXTRA_MILEAGE', description: 'Deduction - Extra Mileage Charge', amount: extraKmCost });
        if (damageCharge > 0) deductions.push({ code: 'DAMAGE_CHARGE', description: 'Deduction - Damage Charge', amount: damageCharge });
        if (otherChargeAmount > 0) deductions.push({ code: 'OTHER_CHARGE', description: `Deduction - Other Charge${otherChargeDescription ? ` (${otherChargeDescription})` : ''}`, amount: otherChargeAmount });
        if (collectionCharge > 0) deductions.push({ code: 'COLLECTION', description: 'Deduction - Collection Charge', amount: collectionCharge });

        const deductionsTotal = deductions.reduce((sum, d) => sum + safeNumber(d.amount), 0);
        const net = deposit - deductionsTotal; // +refund, -customerPay

        const lines = [
            {
                code: 'DEPOSIT',
                description: 'Security Deposit',
                quantity: 1,
                unitPrice: deposit,
                amount: deposit
            },
            ...deductions.map(d => ({
                code: d.code,
                description: d.description,
                quantity: 1,
                unitPrice: safeNumber(d.amount),
                amount: -Math.abs(safeNumber(d.amount))
            })),
            {
                code: 'NET',
                description: net >= 0 ? 'Company Refund Amount' : 'Customer Need Pay Amount',
                quantity: 1,
                unitPrice: Math.abs(net),
                amount: net
            }
        ];

        const subtotal = net;

        // Setup native driver — avoids P2031 on standalone MongoDB
        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);
        const invoiceCollection = db.collection('Invoice');

        let invoiceId;

        if (existing) {
            // Update existing return invoice — native driver write
            await invoiceCollection.updateOne(
                { _id: new ObjectId(existing.id) },
                {
                    $set: {
                        type: 'RETURN',
                        currency: currency || existing.currency || 'LKR',
                        subtotal,
                        total: subtotal,
                        lines,
                        status: existing.status === 'PAID' ? 'PAID' : 'ISSUED',
                        updatedAt: new Date(),
                    }
                }
            );
            invoiceId = existing.id;
        } else {
            // Allocate sequence number via unified Prisma utility
            const next = await getNextSequenceValue(INVOICE_SEQ_KEY);
            const invoiceNo = buildInvoiceNo(next, new Date());

            // Insert new return invoice — native driver write
            const insertResult = await invoiceCollection.insertOne({
                invoiceNo,
                sequence: next,
                type: 'RETURN',
                currency: currency || 'LKR',
                subtotal,
                total: subtotal,
                status: 'ISSUED',
                lines,
                contractId: new ObjectId(contractId),
                customerId: new ObjectId(contract.customerId),
                vehicleId: new ObjectId(contract.vehicleId),
                shareToken: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            invoiceId = insertResult.insertedId.toString();
        }

        // Fetch fully populated invoice via Prisma (read-only — safe)
        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: invoiceIncludeDetail
        });


        // Send return invoice link to the customer email (non-blocking).
        (async () => {
            try {
                const customerEmail = invoice.customer?.email;
                if (!customerEmail) return;
                const invoiceLink = buildInvoiceShareLink(req, invoice.id);
                await sendTemplateEmail('INVOICE_SENT', customerEmail, {
                    customer_name: invoice.customer?.name || invoice.customer?.email || '',
                    invoice_no: invoice.invoiceNo,
                    contract_no: invoice.contract?.contractNo || '',
                    invoice_total: invoice.total,
                    invoice_link: invoiceLink,
                });
            } catch (e) {
                console.error('Failed to send return invoice email:', e?.message || e);
            }
        })();

        const resObj = {
            ...invoice,
            shareUrl: buildInvoiceShareLink(req, invoice.id)
        };
        res.status(201).json(resObj);
    } catch (error) {
        console.error('Create Return Invoice Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to create return invoice' });
    }
};

/**
 * Delete an invoice.
 * - ISSUED status: ADMIN or SUPER_ADMIN required.
 * - PAID status: ONLY SUPER_ADMIN allowed.
 */
exports.deleteInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const userRole = req.user.role;

        const invoice = await prisma.invoice.findUnique({
            where: { id }
        });

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Check Permissions
        if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
            if (userRole !== 'SUPER_ADMIN') {
                return res.status(403).json({ message: 'Only Super Admin can delete a paid or partially paid invoice.' });
            }
        } else {
            // ISSUED or VOID
            if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
                return res.status(403).json({ message: 'Insufficient permissions to delete this invoice.' });
            }
        }

        // Delete the invoice (Cascade will handle LedgerEntry)
        await prisma.invoice.delete({
            where: { id }
        });

        res.json({ message: 'Invoice deleted successfully' });
    } catch (error) {
        console.error('Delete Invoice Error:', error);
        res.status(500).json({ message: error.message || 'Failed to delete invoice' });
    }
};

