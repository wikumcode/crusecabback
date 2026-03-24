const prisma = require('../lib/prisma');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const { sendTemplateEmail } = require('../services/email/email.service');

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
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return 'http://localhost:5000';
    try {
        const u = new URL(origin);
        u.port = '5000';
        return u.origin;
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
    const contractNo = invoice.contract?.contractNo || '-';

    const companyName = company?.name || '';
    const companyAddress = company?.address || '';
    const companyLogoUrl = company?.logoUrl || null;
    const companyContactNumber = company?.contactNumber || '';
    const companyWhatsAppNumber = company?.whatsappNumber || '';

    const showCompanyBrand = !!companyName.trim();
    const companyNameHtml = showCompanyBrand
        ? `<div style="font-weight:900;font-size:22px;line-height:1.1;">${escapeHtml(companyName.trim())}</div>`
        : '';
    const companyLogoHtml = companyLogoUrl
        ? `<img src="${escapeHtml(companyLogoUrl)}" alt="Company Logo" style="height:52px; width:52px; object-fit:contain; border-radius:10px; background:rgba(255,255,255,0.6);" />`
        : '';
    const companyAddressHtml = companyAddress.trim()
        ? `<div class="muted" style="margin-top:6px;">${escapeHtml(companyAddress.trim()).replace(/\n/g, '<br/>')}</div>`
        : '';

    const contactHtml = companyContactNumber.trim()
        ? `<div class="muted" style="margin-top:6px;">Contact: <b>${escapeHtml(companyContactNumber.trim())}</b></div>`
        : '';
    const whatsappHtml = companyWhatsAppNumber.trim()
        ? `<div class="muted" style="margin-top:4px;">WhatsApp: <b>${escapeHtml(companyWhatsAppNumber.trim())}</b></div>`
        : '';

    const amountCell = (amount) => {
        const a = Number(amount || 0);
        const display = isReturn ? (a < 0 ? Math.abs(a) : a) : a;
        return `<td style="text-align:right;">${escapeHtml(display.toLocaleString())}</td>`;
    };

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice.invoiceNo || 'Invoice')}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
    .muted { color:#555; font-size:12px; }
    table { width:100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border-bottom: 1px solid #ddd; padding: 10px 6px; text-align:left; font-size: 13px; }
    th { font-size: 11px; text-transform: uppercase; color:#444; }
    .right { text-align:right; }
    .total { font-weight: 800; font-size: 16px; }
    .pill { font-size: 11px; padding: 4px 10px; border-radius: 999px; display:inline-block; background:#f3f4f6; color:#111; }
  </style>
</head>
<body>
  <div style="margin-bottom:18px;">
    <div style="display:flex;align-items:flex-start;gap:14px;">
      ${showCompanyBrand ? companyLogoHtml : ''}
      <div>
        ${showCompanyBrand ? companyNameHtml : ''}
        ${showCompanyBrand ? companyAddressHtml : ''}
        ${showCompanyBrand ? contactHtml : ''}
        ${showCompanyBrand ? whatsappHtml : ''}
      </div>
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;gap:16px;">
    <div>
      <div style="font-weight:900;font-size:22px;">INVOICE</div>
      <div class="muted">Invoice No: <b>${escapeHtml(invoice.invoiceNo || '')}</b></div>
      <div class="muted">Contract No: <b>${escapeHtml(contractNo)}</b></div>
      <div class="muted">Date: <b>${invoice.createdAt ? new Date(invoice.createdAt).toLocaleString() : ''}</b></div>
      ${settlementLabel ? `<div style="margin-top:8px;"><span class="pill">${escapeHtml(settlementLabel)}</span></div>` : ''}
    </div>
    <div style="text-align:right;">
      <div class="muted">Status</div>
      <div style="font-weight:900;">${escapeHtml(invoice.status || '')}</div>
    </div>
  </div>

  <div style="margin-top:18px;display:flex;justify-content:space-between;gap:16px;">
    <div>
      <div class="muted">Customer</div>
      <div style="font-weight:700;">${escapeHtml(customerName)}</div>
      <div class="muted">${escapeHtml(customerEmail)}</div>
    </div>
    <div style="text-align:right;">
      <div class="muted">Vehicle</div>
      <div style="font-weight:700;">${escapeHtml(vehiclePlate)}</div>
      <div class="muted">${escapeHtml(brandName)} ${escapeHtml(modelName)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th class="right">Amount (LKR)</th></tr>
    </thead>
    <tbody>
      ${lines.map((l) => `
        <tr>
          <td>${escapeHtml(l.description || '')}</td>
          ${amountCell(l.amount)}
        </tr>
      `).join('')}
      <tr>
        <td class="total">Total</td>
        <td class="total right">${escapeHtml(Number(displayTotal || 0).toLocaleString())}</td>
      </tr>
    </tbody>
  </table>

  <div class="muted" style="margin-top:18px;">
    Print tip: use your browser print dialog and choose “Save as PDF”.
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

exports.getInvoiceByContract = async (req, res) => {
    try {
        const { contractId } = req.params;
        const type = (req.query?.type ? String(req.query.type) : 'UPFRONT').toUpperCase();
        const invoice = await prisma.invoice.findFirst({
            where: { contractId, type },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                contract: true,
                creditNotes: true
            }
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        res.json(invoice);
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
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                contract: true,
                creditNotes: true
            }
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        res.json(invoice);
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
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                contract: true,
                creditNotes: true
            }
        });

        if (!invoice) return res.status(404).send('Invoice not found');
        const company = await getCompanyProfileFromSettings();
        res.type('text/html').send(renderInvoiceHtml(invoice, company));
    } catch (error) {
        console.error('Get Shared Invoice Error:', error);
        res.status(500).send('Failed to load invoice');
    }
};

exports.listInvoices = async (req, res) => {
    try {
        const invoices = await prisma.invoice.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                contract: true,
                creditNotes: true
            }
        });
        res.json(invoices);
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

exports.markInvoicePaid = async (req, res) => {
    try {
        const { id } = req.params;
        const { method } = markPaidSchema.parse(req.body || {});

        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: { contract: true }
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (invoice.status === 'PAID') return res.json(invoice);

        const invoiceType = String(invoice.type || '').toUpperCase();
        const lines = Array.isArray(invoice.lines) ? invoice.lines : [];

        const depositLine = lines.find(l => l?.code === 'DEPOSIT');
        const deposit = Number(depositLine?.amount || 0);

        // For UPFRONT:
        // - income = total - deposit (rental/delivery/etc.)
        // - liability = deposit (security deposit)
        //
        // For RETURN:
        // - income = total deductions (consumed deposit + any extra customer payment)
        // - liability decreases by full deposit (deposit is settled/refunded/consumed)
        //
        // Note: This assumes deposit liability was created when UPFRONT invoice was paid.
        // If UPFRONT wasn't paid, RETURN will still post a liability decrease; reports will highlight mismatch.
        let incomeAmount = 0;
        let liabilityDelta = 0;
        if (invoiceType === 'RETURN') {
            const deductionsTotal = lines
                .filter(l => l && l.code !== 'DEPOSIT' && l.code !== 'NET')
                .reduce((sum, l) => sum + Math.max(0, -Number(l.amount || 0)), 0);

            incomeAmount = deductionsTotal;
            // Settle the deposit liability (refund or consume) when return invoice is paid.
            liabilityDelta = deposit > 0 ? -Math.abs(deposit) : 0;
        } else {
            const total = Number(invoice.total || 0);
            incomeAmount = Math.max(0, total - deposit);
            liabilityDelta = deposit > 0 ? Math.abs(deposit) : 0;
        }

        const updated = await prisma.$transaction(async (tx) => {
            const inv = await tx.invoice.update({
                where: { id },
                data: {
                    status: 'PAID',
                    paidAt: new Date(),
                    paidMethod: method || invoice.paidMethod || null
                }
            });

            if (incomeAmount > 0) {
                await tx.ledgerEntry.create({
                    data: {
                        type: 'INCOME',
                        amount: incomeAmount,
                        currency: invoice.currency || 'LKR',
                        description: invoiceType === 'RETURN'
                            ? `Return settlement income for ${invoice.invoiceNo}`
                            : `Invoice ${invoice.invoiceNo} income (excl. deposit)`,
                        invoice: { connect: { id: invoice.id } },
                        contract: { connect: { id: invoice.contractId } },
                        customer: { connect: { id: invoice.customerId } },
                        vehicle: { connect: { id: invoice.vehicleId } },
                    }
                });
            }

            if (liabilityDelta !== 0) {
                await tx.ledgerEntry.create({
                    data: {
                        type: 'LIABILITY',
                        amount: liabilityDelta,
                        currency: invoice.currency || 'LKR',
                        description: invoiceType === 'RETURN'
                            ? `Security deposit settlement for ${invoice.invoiceNo}`
                            : `Security deposit liability for ${invoice.invoiceNo}`,
                        invoice: { connect: { id: invoice.id } },
                        contract: { connect: { id: invoice.contractId } },
                        customer: { connect: { id: invoice.customerId } },
                        vehicle: { connect: { id: invoice.vehicleId } },
                    }
                });
            }

            return inv;
        });

        const full = await prisma.invoice.findUnique({
            where: { id: updated.id },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                contract: true,
                creditNotes: true
            }
        });
        res.json(full);
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

        const created = await prisma.$transaction(async (tx) => {
            const setting = await tx.systemSetting.findUnique({ where: { key: CREDIT_NOTE_SEQ_KEY } });
            const current = setting ? Number(setting.value) || 0 : 0;
            const next = current + 1;

            if (setting) {
                await tx.systemSetting.update({ where: { key: CREDIT_NOTE_SEQ_KEY }, data: { value: String(next) } });
            } else {
                await tx.systemSetting.create({ data: { key: CREDIT_NOTE_SEQ_KEY, value: String(next) } });
            }

            const creditNoteNo = buildCreditNoteNo(next, new Date());
            const cn = await tx.creditNote.create({
                data: {
                    creditNoteNo,
                    sequence: next,
                    reason: reason || null,
                    invoice: { connect: { id: invoice.id } }
                }
            });

            // Reverse ledger impact by adding negative entries (income and liability).
            const entries = await tx.ledgerEntry.findMany({ where: { invoiceId: invoice.id } });
            for (const e of entries) {
                await tx.ledgerEntry.create({
                    data: {
                        type: e.type,
                        amount: -Math.abs(e.amount),
                        currency: e.currency,
                        description: `Credit note ${creditNoteNo} reversal for ${invoice.invoiceNo}`,
                        invoice: { connect: { id: invoice.id } },
                        contract: { connect: { id: e.contractId } },
                        customer: { connect: { id: e.customerId } },
                        vehicle: { connect: { id: e.vehicleId } },
                    }
                });
            }

            await tx.invoice.update({
                where: { id: invoice.id },
                data: { status: 'VOID' }
            });

            return cn;
        });

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
            const invoice = await prisma.invoice.findUnique({
                where: { id: existing.id },
                include: {
                    customer: true,
                    vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                    contract: true
                }
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
                    console.error('Failed to send upfront invoice email:', e?.message || e);
                }
            })();

            return res.status(200).json(invoice);
        }

        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } }
            }
        });
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        const rate = Number(contract.appliedDailyRate) || 0;
        const scheduledDays = daysBetween(contract.pickupDate, contract.dropoffDate);
        const scheduledRentalCharge = rate * scheduledDays;

        // Late return overtime (extra day/time charge)
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

        const rentalCharge = scheduledRentalCharge + extraDayCharge + extraTimeCharge;
        const securityDeposit = Number(contract.securityDeposit) || 0;
        const deliveryCharge = contract.isDelivery ? (Number(contract.deliveryCharge) || 0) : 0;
        const collectionCharge = contract.isCollection ? (Number(contract.collectionCharge) || 0) : 0;

        const lines = [
            {
                code: 'RENTAL',
                description: `Rental Charge (${scheduledDays} day(s) × ${rate} LKR)`,
                quantity: scheduledDays,
                unitPrice: rate,
                amount: scheduledRentalCharge
            }
        ];

        if (extraDays > 0) {
            lines.push({
                code: 'RENTAL_EXTRA_DAYS',
                description: `Late Return Extra Days (${extraDays} day(s))`,
                quantity: extraDays,
                unitPrice: rate,
                amount: extraDayCharge
            });
        }

        if (remainderMinutes > 0) {
            lines.push({
                code: 'RENTAL_EXTRA_TIME',
                description: `Late Return Extra Time (${extraHours}h ${extraMins}m)`,
                quantity: 1,
                unitPrice: rate,
                amount: extraTimeCharge
            });
        }

        // Deposit is always shown separately (kept out of Income when invoice is marked PAID).
        lines.push({
            code: 'DEPOSIT',
            description: 'Security Deposit (Refundable)',
            quantity: 1,
            unitPrice: securityDeposit,
            amount: securityDeposit
        });

        // Extra mileage: remaining km after time-covered mileage.
        const extraMileage = Number(contract.extraKmCost) || 0;
        if (extraMileage > 0) {
            lines.push({
                code: 'EXTRA_MILEAGE',
                description: 'Extra Mileage Charge',
                quantity: 1,
                unitPrice: extraMileage,
                amount: extraMileage
            });
        }

        // Extra return damages/other charges (consumed from security deposit)
        const damageCharge = Number(contract.damageCharge) || 0;
        if (damageCharge > 0) {
            lines.push({
                code: 'DAMAGE_CHARGE',
                description: 'Damage Charge',
                quantity: 1,
                unitPrice: damageCharge,
                amount: damageCharge
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
                amount: otherChargeAmount
            });
        }

        if (deliveryCharge > 0 || contract.isDelivery) {
            lines.push({
                code: 'DELIVERY',
                description: 'Delivery Charge',
                quantity: 1,
                unitPrice: deliveryCharge,
                amount: deliveryCharge
            });
        }
        if (collectionCharge > 0 || contract.isCollection) {
            lines.push({
                code: 'COLLECTION',
                description: 'Collection Charge',
                quantity: 1,
                unitPrice: collectionCharge,
                amount: collectionCharge
            });
        }

        const subtotal = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
        const total = subtotal;

        const invoice = await prisma.$transaction(async (tx) => {
            if (existing) {
                // Recompute totals/lines for an already issued invoice (as long as it isn't paid/void).
                const updated = await tx.invoice.update({
                    where: { id: existing.id },
                    data: {
                        subtotal,
                        total,
                        lines,
                        // Keep existing payment state (e.g. PAID).
                        status: existing.status,
                    }
                });
                return await tx.invoice.findUnique({
                    where: { id: updated.id },
                    include: {
                        customer: true,
                        vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                        contract: true
                    }
                });
            }

            const setting = await tx.systemSetting.findUnique({ where: { key: INVOICE_SEQ_KEY } });
            const current = setting ? Number(setting.value) || 0 : 0;
            const next = current + 1;

            if (setting) {
                await tx.systemSetting.update({
                    where: { key: INVOICE_SEQ_KEY },
                    data: { value: String(next) }
                });
            } else {
                await tx.systemSetting.create({
                    data: { key: INVOICE_SEQ_KEY, value: String(next) }
                });
            }

            const invoiceNo = buildInvoiceNo(next, new Date());
            return await tx.invoice.create({
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
                include: {
                    customer: true,
                    vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                    contract: true
                }
            });
        });

        // Send invoice link to the customer email (non-blocking).
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

        res.status(201).json(invoice);
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
    if (!scheduledEnd || !actualEnd || actualEnd.getTime() <= scheduledEnd.getTime()) {
        return { extraDayCharge, extraTimeRemainderCharge, extraKmCost };
    }

    // Overtime rounded up to minutes
    const overtimeMinutesCeil = Math.ceil((actualEnd.getTime() - scheduledEnd.getTime()) / (1000 * 60));
    const extraDays = Math.floor(overtimeMinutesCeil / 1440);
    const remMinutes = overtimeMinutesCeil - extraDays * 1440;

    extraDayCharge = rate * extraDays;
    extraTimeRemainderCharge = remMinutes > 0 ? rate * (remMinutes / 1440) : 0;

    // Extra mileage coverage: overtime time covers additional km first.
    const dailyKm = safeNumber(contract.dailyKmLimit);
    const allocated = safeNumber(contract.allocatedKm);
    const dailyCoverageKm = Math.round(dailyKm * (overtimeMinutesCeil / 1440));
    const coveredKm = allocated + dailyCoverageKm;

    const startOdo = safeNumber(contract.startOdometer);
    const endOdo = safeNumber(extraData.endOdometer ?? contract.endOdometer);
    const usedKm = endOdo > 0 ? Math.max(0, endOdo - startOdo) : 0;

    const remainingExtraKm = Math.max(0, usedKm - coveredKm);
    const perKmRate = safeNumber(contract.extraMileageCharge);
    extraKmCost = remainingExtraKm * perKmRate;

    return { extraDayCharge, extraTimeRemainderCharge, extraKmCost };
}

exports.createReturnInvoiceForContract = async (req, res) => {
    try {
        const { contractId } = req.params;
        const { currency } = createUpfrontSchema.parse(req.body || {});

        const existing = await prisma.invoice.findFirst({ where: { contractId, type: 'RETURN' } });
        if (existing && existing.status === 'PAID') {
            const invoice = await prisma.invoice.findUnique({
                where: { id: existing.id },
                include: {
                    customer: true,
                    vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                    contract: true,
                    creditNotes: true
                }
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

            return res.status(200).json(invoice);
        }

        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } }
            }
        });
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

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

        const invoice = await prisma.$transaction(async (tx) => {
            if (existing) {
                // Update invoice lines for return context, keep invoiceNo/sequence stable.
                const updated = await tx.invoice.update({
                    where: { id: existing.id },
                    data: {
                        type: 'RETURN',
                        currency: currency || existing.currency || 'LKR',
                        subtotal,
                        total: subtotal,
                        lines,
                        status: existing.status === 'PAID' ? 'PAID' : 'ISSUED'
                    }
                });
                return await tx.invoice.findUnique({
                    where: { id: updated.id },
                    include: {
                        customer: true,
                        vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                        contract: true,
                        creditNotes: true
                    }
                });
            }

            const setting = await tx.systemSetting.findUnique({ where: { key: INVOICE_SEQ_KEY } });
            const current = setting ? safeNumber(setting.value) : 0;
            const next = current + 1;

            if (setting) {
                await tx.systemSetting.update({
                    where: { key: INVOICE_SEQ_KEY },
                    data: { value: String(next) }
                });
            } else {
                await tx.systemSetting.create({
                    data: { key: INVOICE_SEQ_KEY, value: String(next) }
                });
            }

            const invoiceNo = buildInvoiceNo(next, new Date());

            return await tx.invoice.create({
                data: {
                    invoiceNo,
                    sequence: next,
                    type: 'RETURN',
                    currency: currency || 'LKR',
                    subtotal,
                    total: subtotal,
                    status: 'ISSUED',
                    lines,
                    contract: { connect: { id: contractId } },
                    customer: { connect: { id: contract.customerId } },
                    vehicle: { connect: { id: contract.vehicleId } },
                },
                include: {
                    customer: true,
                    vehicle: { include: { vehicleModel: { include: { brand: true } }, vendor: true } },
                    contract: true,
                    creditNotes: true
                }
            });
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

        res.status(201).json(invoice);
    } catch (error) {
        console.error('Create Return Invoice Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to create return invoice' });
    }
};

