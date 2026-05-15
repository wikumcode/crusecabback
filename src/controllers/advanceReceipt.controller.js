const prisma = require('../lib/prisma');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { getMongoClient, getNextSequenceValue } = require('../utils/sequence');
const { ObjectId } = require('mongodb');
const invoiceCtrl = require('./invoice.controller');
const { DOCUMENT_PRINT_STYLES } = require('../lib/documentPrintStyles');
const { formatDate, formatDateTime } = require('../lib/dates');

const AR_SHARE_TTL = '7d';

function pad(num, size) {
    const s = String(num);
    return s.length >= size ? s : '0'.repeat(size - s.length) + s;
}

function advanceReceiptSeqKey(date = new Date()) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `advance_receipt_sequence_${yyyy}_${mm}`;
}

function rarSeqKey(date = new Date()) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `rar_sequence_${yyyy}_${mm}`;
}

/** e.g. AR/05/2026/00002 — same pattern as contract numbers (CON/MM/YYYY/#####). */
function buildReceiptNo(sequence, date = new Date()) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `AR/${mm}/${yyyy}/${pad(sequence, 5)}`;
}

/** Advance reversal credit note e.g. RAR/05/2026/00001 */
function buildRarNo(sequence, date = new Date()) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `RAR/${mm}/${yyyy}/${pad(sequence, 5)}`;
}

function getBackendBaseUrlFromReq(req) {
    if (process.env.BACKEND_URL) {
        return process.env.BACKEND_URL.replace(/\/$/, '');
    }
    const protocol = req.protocol || 'https';
    const host = req.headers.host;
    if (host) return `${protocol}://${host}`;
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return 'http://localhost:5000';
    try {
        return new URL(origin).origin;
    } catch {
        return 'http://localhost:5000';
    }
}

function buildAdvanceReceiptShareLink(req, receiptId) {
    const token = jwt.sign({ advanceReceiptId: receiptId }, process.env.JWT_SECRET, { expiresIn: AR_SHARE_TTL });
    const backendBase = getBackendBaseUrlFromReq(req);
    return `${backendBase}/api/advance-receipts/share/${receiptId}?token=${encodeURIComponent(token)}`;
}

const receiptInclude = {
    contract: {
        include: {
            customer: true,
            vehicle: { include: { vehicleModel: { include: { brand: true } } } },
        },
    },
    // Schema is one-to-many (see schema.prisma rationale), but the partial
    // unique index + app code ensure at most one row exists; the helper
    // `firstLinkedPayment(receipt)` below collapses this back into a single
    // payment object for the rest of the controller.
    linkedPayments: true,
    advanceReversal: { select: { id: true, rarNo: true } },
};

function firstLinkedPayment(receipt) {
    if (!receipt) return null;
    const list = Array.isArray(receipt.linkedPayments) ? receipt.linkedPayments : [];
    return list[0] || null;
}

function resolveLogoUrl(logoUrl, baseUrl) {
    if (!logoUrl || logoUrl === 'false') return null;
    if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) return logoUrl;
    return `${baseUrl}${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`;
}

/**
 * Same visual system as shared quotations: DOCUMENT_PRINT_STYLES, orange accent bar, cards, table + tfoot.
 */
function renderAdvanceReceiptHtml(receipt, company = {}, baseUrl = '') {
    const escapeHtml = invoiceCtrl.escapeHtml;
    const customer = receipt.contract?.customer;
    const customerName = customer?.name || customer?.email || '';
    const customerEmail = customer?.email || '';
    const customerType = String(customer?.type || '').trim();
    const vehiclePlate = receipt.contract?.vehicle?.licensePlate || '';
    const brandName = receipt.contract?.vehicle?.vehicleModel?.brand?.name || '';
    const modelName = receipt.contract?.vehicle?.vehicleModel?.name || '';
    const vehLabel = `${brandName} ${modelName}`.trim();
    const contractNo = receipt.contract?.contractNo || '-';
    const receiptNo = receipt.receiptNo || '';
    const amount = Number(receipt.amount || 0);
    const amountStr = escapeHtml(amount.toLocaleString());
    const paymentDateStr = receipt.paymentDate ? formatDate(receipt.paymentDate, '') : '';
    const issuedAtStr = receipt.createdAt ? formatDateTime(receipt.createdAt, '') : '';

    const logoResolved = resolveLogoUrl(company.logoUrl, baseUrl);
    const showBrand = !!(company.name?.trim() || logoResolved);
    const logoImg = logoResolved
        ? `<img class="doc-logo" src="${escapeHtml(logoResolved)}" alt="" />`
        : '';
    const nameBlock = company.name?.trim()
        ? `<div class="doc-company-name">${escapeHtml(company.name.trim())}</div>`
        : logoResolved
            ? `<div class="doc-company-name" style="font-size:16px;color:var(--muted);">Your rental partner</div>`
            : '';
    const addrBlock = company.address?.trim()
        ? `<div class="doc-company-muted">${escapeHtml(company.address.trim()).replace(/\n/g, '<br/>')}</div>`
        : '';
    const chips = [];
    if (company.contactNumber?.trim()) {
        chips.push(`<span class="doc-chip">Contact ${escapeHtml(company.contactNumber.trim())}</span>`);
    }
    if (company.whatsappNumber?.trim()) {
        chips.push(`<span class="doc-chip">WhatsApp ${escapeHtml(company.whatsappNumber.trim())}</span>`);
    }
    const chipRow = chips.length ? `<div class="doc-chip-row">${chips.join('')}</div>` : '';
    const brandSection = showBrand
        ? `<div class="doc-brand-row">${logoImg}<div>${nameBlock}${addrBlock}${chipRow}</div></div>`
        : '';

    const typeChipRow = customerType
        ? `<div class="doc-chip-row" style="margin-top:10px;"><span class="doc-chip">${escapeHtml(customerType)}</span></div>`
        : '';

    const descBody = paymentDateStr
        ? `Advance payment on contract <b>${escapeHtml(contractNo)}</b> — recorded payment date <b>${escapeHtml(paymentDateStr)}</b>.`
        : `Advance payment on contract <b>${escapeHtml(contractNo)}</b>.`;

    const paymentDetailsCard = `
      <div class="doc-card" style="margin-bottom:16px;background:#fff;border-style:dashed;">
        <div class="doc-card-label">Contract & payment</div>
        <div class="doc-card-value" style="font-size:15px;">
          <div><b>Contract no:</b> ${escapeHtml(contractNo)}</div>
          ${paymentDateStr ? `<div style="margin-top:6px;"><b>Payment date:</b> ${escapeHtml(paymentDateStr)}</div>` : ''}
        </div>
      </div>`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(receiptNo)} — Advance receipt</title>
  <style>${DOCUMENT_PRINT_STYLES}</style>
</head>
<body>
  <div class="doc">
    <div class="doc-topbar"></div>
    <div class="doc-inner">
      ${brandSection}
      <div class="doc-headline">
        <div>
          <div class="doc-kind">Advance receipt</div>
          <div class="doc-main-id">${escapeHtml(receiptNo)}</div>
          <div class="doc-meta">Issued <b>${escapeHtml(issuedAtStr)}</b> · Contract <b>${escapeHtml(contractNo)}</b></div>
        </div>
        <div class="doc-pill doc-pill-em">Official receipt</div>
      </div>

      <div class="doc-cards">
        <div class="doc-card">
          <div class="doc-card-label">Customer</div>
          <div class="doc-card-value">${escapeHtml(customerName)}</div>
          <div class="doc-card-sub">${escapeHtml(customerEmail || '—')}</div>
          ${typeChipRow}
        </div>
        <div class="doc-card">
          <div class="doc-card-label">Vehicle</div>
          <div class="doc-card-value">${escapeHtml(vehiclePlate)}</div>
          <div class="doc-card-sub">${escapeHtml(vehLabel || '—')}</div>
        </div>
      </div>

      ${paymentDetailsCard}

      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Description</th><th>Amount (LKR)</th></tr>
          </thead>
          <tbody>
            <tr><td>${descBody}</td><td>${amountStr}</td></tr>
          </tbody>
          <tfoot>
            <tr><td>Amount received</td><td>${amountStr}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="doc-foot">
        System-generated advance receipt — use your browser print dialog to save as PDF if needed.
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

function renderAdvanceReversalPreviewHtml(receipt, company = {}, baseUrl = '', provisionalNoLabel) {
    const escapeHtml = invoiceCtrl.escapeHtml;
    const customer = receipt.contract?.customer;
    const customerName = customer?.name || customer?.email || '';
    const customerEmail = customer?.email || '';
    const vehiclePlate = receipt.contract?.vehicle?.licensePlate || '';
    const brandName = receipt.contract?.vehicle?.vehicleModel?.brand?.name || '';
    const modelName = receipt.contract?.vehicle?.vehicleModel?.name || '';
    const vehLabel = `${brandName} ${modelName}`.trim();
    const contractNo = receipt.contract?.contractNo || '-';
    const arNo = receipt.receiptNo || '';
    const amount = Number(receipt.amount || 0);
    const amountStr = escapeHtml(amount.toLocaleString());
    const logoResolved = resolveLogoUrl(company.logoUrl, baseUrl);
    const showBrand = !!(company.name?.trim() || logoResolved);
    const logoImg = logoResolved
        ? `<img class="doc-logo" src="${escapeHtml(logoResolved)}" alt="" />`
        : '';
    const nameBlock = company.name?.trim()
        ? `<div class="doc-company-name">${escapeHtml(company.name.trim())}</div>`
        : '';
    const addrBlock = company.address?.trim()
        ? `<div class="doc-company-muted">${escapeHtml(company.address.trim()).replace(/\n/g, '<br/>')}</div>`
        : '';
    const brandSection = showBrand
        ? `<div class="doc-brand-row">${logoImg}<div>${nameBlock}${addrBlock}</div></div>`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reversal credit note preview</title>
  <style>${DOCUMENT_PRINT_STYLES}</style>
</head>
<body>
  <div class="doc">
    <div class="doc-topbar"></div>
    <div class="doc-inner">
      ${brandSection}
      <div class="doc-headline">
        <div>
          <div class="doc-kind">Reversal credit note (preview)</div>
          <div class="doc-main-id">${escapeHtml(provisionalNoLabel)}</div>
          <div class="doc-meta">Reverses advance receipt <b>${escapeHtml(arNo)}</b> · Contract <b>${escapeHtml(contractNo)}</b></div>
        </div>
        <div class="doc-pill">Preview</div>
      </div>

      <div class="doc-cards">
        <div class="doc-card">
          <div class="doc-card-label">Customer</div>
          <div class="doc-card-value">${escapeHtml(customerName)}</div>
          <div class="doc-card-sub">${escapeHtml(customerEmail || '—')}</div>
        </div>
        <div class="doc-card">
          <div class="doc-card-label">Vehicle</div>
          <div class="doc-card-value">${escapeHtml(vehiclePlate)}</div>
          <div class="doc-card-sub">${escapeHtml(vehLabel || '—')}</div>
        </div>
      </div>

      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Description</th><th>Amount (LKR)</th></tr>
          </thead>
          <tbody>
            <tr><td>Reverse advance payment posted from receipt <b>${escapeHtml(arNo)}</b> (removes proportional income and deposit liability from P&amp;L).</td><td>${amountStr}</td></tr>
          </tbody>
          <tfoot>
            <tr><td>Net reversal</td><td>-${amountStr}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="doc-foot">
        Confirm to issue the numbered RAR document and remove this payment from P&amp;L. Number is assigned on confirm.
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

function renderAdvanceReversalIssuedHtml(reversal, receipt, company = {}, baseUrl = '') {
    const escapeHtml = invoiceCtrl.escapeHtml;
    const customer = receipt.contract?.customer;
    const customerName = customer?.name || customer?.email || '';
    const customerEmail = customer?.email || '';
    const vehiclePlate = receipt.contract?.vehicle?.licensePlate || '';
    const brandName = receipt.contract?.vehicle?.vehicleModel?.brand?.name || '';
    const modelName = receipt.contract?.vehicle?.vehicleModel?.name || '';
    const vehLabel = `${brandName} ${modelName}`.trim();
    const contractNo = receipt.contract?.contractNo || '-';
    const arNo = receipt.receiptNo || '';
    const rarNo = reversal.rarNo || '';
    const amount = Number(reversal.amount || 0);
    const amountStr = escapeHtml(amount.toLocaleString());
    const logoResolved = resolveLogoUrl(company.logoUrl, baseUrl);
    const showBrand = !!(company.name?.trim() || logoResolved);
    const logoImg = logoResolved
        ? `<img class="doc-logo" src="${escapeHtml(logoResolved)}" alt="" />`
        : '';
    const nameBlock = company.name?.trim()
        ? `<div class="doc-company-name">${escapeHtml(company.name.trim())}</div>`
        : '';
    const addrBlock = company.address?.trim()
        ? `<div class="doc-company-muted">${escapeHtml(company.address.trim()).replace(/\n/g, '<br/>')}</div>`
        : '';
    const brandSection = showBrand
        ? `<div class="doc-brand-row">${logoImg}<div>${nameBlock}${addrBlock}</div></div>`
        : '';
    const issuedAtStr = reversal.createdAt ? formatDateTime(reversal.createdAt, '') : '';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(rarNo)} — Reversal credit note</title>
  <style>${DOCUMENT_PRINT_STYLES}</style>
</head>
<body>
  <div class="doc">
    <div class="doc-topbar"></div>
    <div class="doc-inner">
      ${brandSection}
      <div class="doc-headline">
        <div>
          <div class="doc-kind">Reversal credit note</div>
          <div class="doc-main-id">${escapeHtml(rarNo)}</div>
          <div class="doc-meta">Issued <b>${escapeHtml(issuedAtStr)}</b> · Contract <b>${escapeHtml(contractNo)}</b></div>
        </div>
        <div class="doc-pill doc-pill-em">RAR</div>
      </div>

      <div class="doc-cards">
        <div class="doc-card">
          <div class="doc-card-label">Customer</div>
          <div class="doc-card-value">${escapeHtml(customerName)}</div>
          <div class="doc-card-sub">${escapeHtml(customerEmail || '—')}</div>
        </div>
        <div class="doc-card">
          <div class="doc-card-label">Vehicle</div>
          <div class="doc-card-value">${escapeHtml(vehiclePlate)}</div>
          <div class="doc-card-sub">${escapeHtml(vehLabel || '—')}</div>
        </div>
      </div>

      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Description</th><th>Amount (LKR)</th></tr>
          </thead>
          <tbody>
            <tr><td>Reversal of advance receipt <b>${escapeHtml(arNo)}</b>${reversal.reason ? ` — ${escapeHtml(reversal.reason)}` : ''}</td><td>-${amountStr}</td></tr>
          </tbody>
          <tfoot>
            <tr><td>Net reversal</td><td>-${amountStr}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="doc-foot">
        This document offsets the proportional income and security-deposit liability that were posted when the advance receipt was created.
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

const issueSchema = z.object({
    contractId: z.string().min(1),
    /** When set (e.g. from contract form before save), used for the receipt instead of DB-only values. */
    amount: z.union([z.number(), z.string()]).optional(),
    paymentDate: z.union([z.string(), z.date(), z.null()]).optional(),
});

const reverseSchema = z.object({
    reason: z.string().optional(),
});

/** Mongo Atlas + invoice/ledger steps easily exceed Prisma default interactive timeout (5s). */
const TX_OPTS_ISSUE = {
    maxWait: 15000,
    timeout: 45000,
};
const TX_OPTS_REVERSE = {
    maxWait: 15000,
    timeout: 45000,
};

function safeMoney(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
}

function parseOptionalPaymentDate(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

exports.issueAdvanceReceipt = async (req, res) => {
    try {
        const body = issueSchema.parse(req.body);
        const { contractId } = body;

        const amtFromBody = body.amount !== undefined && body.amount !== null && body.amount !== ''
            ? safeMoney(body.amount)
            : null;

        const dateFromBody = parseOptionalPaymentDate(body.paymentDate);

        const issueDate = new Date();
        const seqKey = advanceReceiptSeqKey(issueDate);

        // Native Driver setup
        const client = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = client.db(dbName);

        const receiptCollection = db.collection('AdvanceReceipt');
        const contractCollection = db.collection('Contract');

        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
        });
        if (!contract) throw new Error('Contract not found');

        const amtFromDb = safeMoney(contract.advancePaymentAmount);
        const amt = amtFromBody !== null && amtFromBody > 0 ? amtFromBody : amtFromDb;

        if (!(amt > 0.009)) {
            throw new Error(
                'Advance amount must be greater than zero. Enter an amount on the contract (or save the contract after entering it), then try again.',
            );
        }

        const paymentDate =
            dateFromBody !== null
                ? dateFromBody
                : (contract.advancePaymentDate || null);

        const voidOnly = await prisma.invoice.findFirst({
            where: { contractId, type: 'UPFRONT', status: 'VOID' },
        });
        const liveUpfront = await prisma.invoice.findFirst({
            where: { contractId, type: 'UPFRONT', NOT: { status: 'VOID' } },
        });
        if (voidOnly && !liveUpfront) {
            throw new Error(
                'Upfront invoice is void. Recreate the upfront invoice from the Invoices page before posting an advance receipt.',
            );
        }

        const postedOpen = await prisma.advanceReceipt.findFirst({
            where: { contractId, ledgerPostedAt: { not: null }, reversedAt: null },
        });
        if (postedOpen) {
            throw new Error(
                'This contract already has a posted advance receipt. Reverse it first if you need to change the posting.',
            );
        }

        // Native Driver for atomic sequence update
        const next = await getNextSequenceValue(seqKey);
        const receiptNo = buildReceiptNo(next, issueDate);

        // Native Insert for AdvanceReceipt
        const receiptDoc = {
            receiptNo,
            sequence: next,
            amount: amt,
            paymentDate: paymentDate ? new Date(paymentDate) : null,
            contractId: new ObjectId(contractId),
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const receiptResult = await receiptCollection.insertOne(receiptDoc);
        const receiptId = receiptResult.insertedId.toString();

        // Native Ensure Upfront Invoice
        const inv = await invoiceCtrl.ensureUpfrontInvoiceNative(db, contractId, contract, 'LKR');
        if (!inv) throw new Error('Could not prepare upfront invoice');

        const paidSum = invoiceCtrl.sumPaymentsTowardBalance(inv);
        const netTotal = invoiceCtrl.roundMoney(Number(inv.total || 0));
        const remaining = invoiceCtrl.roundMoney(netTotal - paidSum);
        const lines = Array.isArray(inv.lines) ? inv.lines : [];
        const advanceLine = lines.find((l) => l?.code === 'ADVANCE_PAID');
        const advanceOnInvoice = advanceLine ? Math.abs(Number(advanceLine.amount || 0)) : 0;

        if (remaining <= invoiceCtrl.MONEY_EPS && advanceOnInvoice > invoiceCtrl.MONEY_EPS) {
            if (amt > advanceOnInvoice + invoiceCtrl.MONEY_EPS) {
                throw new Error(
                    `Advance amount exceeds the advance on the invoice (${advanceOnInvoice}). Save the contract so the invoice matches, or reduce the amount.`,
                );
            }
        } else if (amt > remaining + invoiceCtrl.MONEY_EPS) {
            throw new Error(`Advance amount exceeds balance due (${remaining}).`);
        }

        // Native Apply Payment
        await invoiceCtrl.applyUpfrontPaymentNative(db, inv, amt, 'ADVANCE_RECEIPT', {
            advanceReceiptId: receiptId,
        });

        // Native Update Receipt
        await receiptCollection.updateOne(
            { _id: new ObjectId(receiptId) },
            { $set: { ledgerPostedAt: new Date(), updatedAt: new Date() } }
        );

        if (contract.status === 'UPCOMING') {
            await contractCollection.updateOne(
                { _id: new ObjectId(contractId) },
                { $set: { upfrontReleased: false, updatedAt: new Date() } }
            );
        }

        const receipt = await prisma.advanceReceipt.findUnique({
            where: { id: receiptId },
            include: receiptInclude,
        });

        const shareUrl = buildAdvanceReceiptShareLink(req, receipt.id);
        res.status(201).json({ ...receipt, shareUrl });
    } catch (error) {
        console.error('Issue advance receipt error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to issue advance receipt' });
    }
};

exports.listAdvanceReceipts = async (req, res) => {
    try {
        const { search, contractId } = req.query;
        const page = parseInt(req.query.page) || 1;
        const requestedLimit = parseInt(req.query.limit) || 20;
        const limit = Math.min(requestedLimit, 100);
        const skip = (page - 1) * limit;

        const where = {};
        if (contractId && typeof contractId === 'string') {
            where.contractId = contractId;
        }

        if (search) {
            where.OR = [
                { receiptNo: { contains: search, mode: 'insensitive' } },
                { contract: { customer: { name: { contains: search, mode: 'insensitive' } } } },
                { contract: { customer: { companyName: { contains: search, mode: 'insensitive' } } } }
            ];
        }

        const [rows, totalCount] = await Promise.all([
            prisma.advanceReceipt.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: receiptInclude,
                skip,
                take: limit
            }),
            prisma.advanceReceipt.count({ where })
        ]);

        res.json({
            data: rows,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('List advance receipts error:', error);
        res.status(500).json({ message: 'Failed to list advance receipts' });
    }
};

exports.getAdvanceReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const receipt = await prisma.advanceReceipt.findUnique({
            where: { id },
            include: receiptInclude,
        });
        if (!receipt) return res.status(404).json({ message: 'Receipt not found' });
        res.json(receipt);
    } catch (error) {
        console.error('Get advance receipt error:', error);
        res.status(500).json({ message: 'Failed to load receipt' });
    }
};

exports.getShareLink = async (req, res) => {
    try {
        const { id } = req.params;
        const receipt = await prisma.advanceReceipt.findUnique({ where: { id } });
        if (!receipt) return res.status(404).json({ message: 'Receipt not found' });
        const shareUrl = buildAdvanceReceiptShareLink(req, receipt.id);
        res.json({ shareUrl });
    } catch (error) {
        console.error('Advance receipt share link error:', error);
        res.status(500).json({ message: 'Failed to build link' });
    }
};

exports.getAdvanceReceiptHtml = async (req, res) => {
    try {
        const { id } = req.params;
        const receipt = await prisma.advanceReceipt.findUnique({
            where: { id },
            include: receiptInclude,
        });
        if (!receipt) return res.status(404).send('Receipt not found');
        const company = await invoiceCtrl.getCompanyProfileFromSettings();
        const baseUrl = getBackendBaseUrlFromReq(req);
        res.type('text/html').send(renderAdvanceReceiptHtml(receipt, company, baseUrl));
    } catch (error) {
        console.error('Advance receipt HTML error:', error);
        res.status(500).send('Failed to load receipt');
    }
};

exports.getReversalPreviewHtml = async (req, res) => {
    try {
        const { id } = req.params;
        const receipt = await prisma.advanceReceipt.findUnique({
            where: { id },
            include: receiptInclude,
        });
        if (!receipt) return res.status(404).send('Receipt not found');
        if (!receipt.ledgerPostedAt) {
            return res.status(400).send('This receipt was not posted to the ledger (legacy). Nothing to reverse.');
        }
        if (receipt.reversedAt) return res.status(400).send('This receipt is already reversed.');
        if (!firstLinkedPayment(receipt)) {
            return res.status(400).send('No linked invoice payment found for this receipt.');
        }
        const company = await invoiceCtrl.getCompanyProfileFromSettings();
        const baseUrl = getBackendBaseUrlFromReq(req);
        const mm = String(new Date().getMonth() + 1).padStart(2, '0');
        const yyyy = String(new Date().getFullYear());
        const provisional = `RAR/${mm}/${yyyy}/##### (on confirm)`;
        res.type('text/html').send(renderAdvanceReversalPreviewHtml(receipt, company, baseUrl, provisional));
    } catch (error) {
        console.error('Reversal preview error:', error);
        res.status(500).send('Failed to load preview');
    }
};

exports.reverseAdvanceReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = reverseSchema.parse(req.body || {});

        // Native Driver setup
        const client = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = client.db(dbName);

        const receiptCollection = db.collection('AdvanceReceipt');
        const reversalCollection = db.collection('AdvanceReversalCredit');
        const ledgerCollection = db.collection('LedgerEntry');
        const paymentCollection = db.collection('InvoicePayment');
        const invoiceCollection = db.collection('Invoice');

        const receipt = await prisma.advanceReceipt.findUnique({
            where: { id },
            include: receiptInclude,
        });
        if (!receipt) throw new Error('Receipt not found');
        if (!receipt.ledgerPostedAt) throw new Error('Receipt was not posted to the ledger; nothing to reverse.');
        if (receipt.reversedAt) throw new Error('Already reversed.');
        if (receipt.advanceReversal) throw new Error('Reversal record already exists.');
        const payment = firstLinkedPayment(receipt);
        if (!payment) throw new Error('No linked invoice payment for this receipt.');

        const invoice = await prisma.invoice.findUnique({
            where: { id: payment.id ? (payment.invoiceId || receipt.contractId) : payment.invoiceId }, // Simplified fallback
        });
        // Correcting invoice lookup: payment.invoiceId is the source of truth
        const actualInvoice = await prisma.invoice.findUnique({
            where: { id: payment.invoiceId },
        });
        if (!actualInvoice) throw new Error('Invoice not found');

        const lines = Array.isArray(actualInvoice.lines) ? actualInvoice.lines : [];
        const depositLine = lines.find((l) => l?.code === 'DEPOSIT');
        const deposit = Number(depositLine?.amount || 0);
        const payAmt = invoiceCtrl.roundMoney(Number(payment.amount || 0));

        const ordered = await prisma.invoicePayment.findMany({
            where: { invoiceId: actualInvoice.id },
            orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        });
        const idx = ordered.findIndex((p) => p.id === payment.id);
        const priorCash =
            idx <= 0
                ? 0
                : ordered.slice(0, idx).reduce((s, p) => s + Number(p.amount || 0), 0);
        const { income, liability } = invoiceCtrl.computeDepositFirstLedgerSplit(deposit, priorCash, payAmt);

        if (income > invoiceCtrl.MONEY_EPS) {
            await ledgerCollection.insertOne({
                type: 'INCOME',
                amount: -Math.abs(income),
                currency: actualInvoice.currency || 'LKR',
                description: `RAR reversal — advance receipt ${receipt.receiptNo} (income offset)`,
                invoiceId: new ObjectId(actualInvoice.id),
                contractId: new ObjectId(actualInvoice.contractId),
                customerId: new ObjectId(actualInvoice.customerId),
                vehicleId: new ObjectId(actualInvoice.vehicleId),
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }
        if (Math.abs(liability) > invoiceCtrl.MONEY_EPS) {
            await ledgerCollection.insertOne({
                type: 'LIABILITY',
                amount: -Math.abs(liability),
                currency: actualInvoice.currency || 'LKR',
                description: `RAR reversal — advance receipt ${receipt.receiptNo} (liability offset)`,
                invoiceId: new ObjectId(actualInvoice.id),
                contractId: new ObjectId(actualInvoice.contractId),
                customerId: new ObjectId(actualInvoice.customerId),
                vehicleId: new ObjectId(actualInvoice.vehicleId),
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        await paymentCollection.deleteOne({ _id: new ObjectId(payment.id) });
        await invoiceCtrl.refreshInvoicePaidStatusNative(db, actualInvoice.id);

        const issueDate = new Date();
        const rk = rarSeqKey(issueDate);
        
        // Native Driver for atomic sequence update
        const nxt = await getNextSequenceValue(rk);
        const rarNo = buildRarNo(nxt, issueDate);

        const reversalDoc = {
            rarNo,
            sequence: nxt,
            amount: payAmt,
            reason: reason || null,
            advanceReceiptId: new ObjectId(receipt.id),
            invoiceId: new ObjectId(actualInvoice.id),
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const reversalResult = await reversalCollection.insertOne(reversalDoc);

        await receiptCollection.updateOne(
            { _id: new ObjectId(receipt.id) },
            { $set: { reversedAt: new Date(), updatedAt: new Date() } }
        );

        const fullReversal = await prisma.advanceReversalCredit.findUnique({ 
            where: { id: reversalResult.insertedId.toString() } 
        });
        const fullReceipt = await prisma.advanceReceipt.findUnique({
            where: { id: receipt.id },
            include: receiptInclude,
        });

        res.status(201).json({ reversal: fullReversal, receipt: fullReceipt });
    } catch (error) {
        console.error('Reverse advance receipt error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to reverse advance receipt' });
    }
};

exports.getReversalHtml = async (req, res) => {
    try {
        const { reversalId } = req.params;
        const reversal = await prisma.advanceReversalCredit.findUnique({
            where: { id: reversalId },
            include: { advanceReceipt: { include: receiptInclude } },
        });
        if (!reversal) return res.status(404).send('Not found');
        const company = await invoiceCtrl.getCompanyProfileFromSettings();
        const baseUrl = getBackendBaseUrlFromReq(req);
        res.type('text/html').send(
            renderAdvanceReversalIssuedHtml(reversal, reversal.advanceReceipt, company, baseUrl),
        );
    } catch (error) {
        console.error('RAR HTML error:', error);
        res.status(500).send('Failed to load document');
    }
};

exports.getSharedAdvanceReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const { token } = req.query;
        if (!token) return res.status(401).send('Missing token');

        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).send('Invalid or expired token');
        }

        if (!payload?.advanceReceiptId || payload.advanceReceiptId !== id) {
            return res.status(403).send('Forbidden');
        }

        const receipt = await prisma.advanceReceipt.findUnique({
            where: { id },
            include: receiptInclude,
        });
        if (!receipt) return res.status(404).send('Receipt not found');

        const company = await invoiceCtrl.getCompanyProfileFromSettings();
        const baseUrl = getBackendBaseUrlFromReq(req);
        res.type('text/html').send(renderAdvanceReceiptHtml(receipt, company, baseUrl));
    } catch (error) {
        console.error('Shared advance receipt error:', error);
        res.status(500).send('Failed to load receipt');
    }
};
