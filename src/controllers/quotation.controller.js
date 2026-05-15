const crypto = require('crypto');
const prisma = require('../lib/prisma'); // keep explicit import for quotation persistence
const { getMongoClient, getNextSequenceValue } = require('../utils/sequence');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { DOCUMENT_PRINT_STYLES } = require('../lib/documentPrintStyles');
const { formatDateTime: formatDateTimeShared } = require('../lib/dates');

const QUOTATION_SHARE_TOKEN_TTL = '30d';
const SHARE_TOKEN_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; // no ambiguous 0/O/1/l

function randomShareTokenChars(length = 12) {
    let out = '';
    for (let i = 0; i < length; i++) {
        out += SHARE_TOKEN_CHARS[crypto.randomInt(0, SHARE_TOKEN_CHARS.length)];
    }
    return out;
}

/** Persists a short opaque token on the quotation (lazy, collision-safe). */
async function ensureQuotationShareToken(quotationId) {
    const existing = await prisma.quotation.findUnique({
        where: { id: quotationId },
        select: { shareToken: true },
    });
    if (!existing) return null;
    if (existing.shareToken) return existing.shareToken;
    for (let attempt = 0; attempt < 8; attempt++) {
        const token = randomShareTokenChars(12);
        try {
            await prisma.quotation.update({
                where: { id: quotationId },
                data: { shareToken: token },
            });
            return token;
        } catch (e) {
            if (e?.code === 'P2002') continue;
            throw e;
        }
    }
    throw new Error('Failed to allocate share token');
}

/**
 * Allocates a fresh, collision-free share token for a brand-new quotation.
 *
 * MongoDB treats a regular unique index entry of `null` as a real value, so a
 * second insert with `shareToken == null` raises `Quotation_share_token_key`.
 * We therefore generate the token at create time so the column is never null.
 */
async function allocateNewShareToken(db) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const token = randomShareTokenChars(12);
        const clash = await db.collection('Quotation').findOne({ shareToken: token });
        if (!clash) return token;
    }
    throw new Error('Failed to allocate share token after multiple attempts');
}

function getBackendBaseUrlFromReq(req) {
    if (process.env.BACKEND_URL) {
        return process.env.BACKEND_URL.replace(/\/$/, '');
    }
    const protocol = req.protocol || 'https';
    const host = req.headers.host;
    if (host) {
        return `${protocol}://${host}`;
    }
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return 'http://localhost:5000';
    try {
        return new URL(origin).origin;
    } catch {
        return 'http://localhost:5000';
    }
}

function buildQuotationShareLinkJwtFallback(req, quotationId) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
    }
    const token = jwt.sign({ quotationId }, process.env.JWT_SECRET, { expiresIn: QUOTATION_SHARE_TOKEN_TTL });
    const backendBase = getBackendBaseUrlFromReq(req);
    return `${backendBase}/api/quotations/share/${quotationId}?token=${encodeURIComponent(token)}`;
}

/** Prefer short /api/q/:token; if DB cannot store shareToken yet, use signed JWT URL (still works). */
async function buildQuotationShareLink(req, quotationId) {
    try {
        const shareToken = await ensureQuotationShareToken(quotationId);
        if (!shareToken) throw new Error('Quotation not found');
        const backendBase = getBackendBaseUrlFromReq(req);
        return `${backendBase}/api/q/${shareToken}`;
    } catch (err) {
        console.warn('Short quotation share link unavailable, using JWT fallback:', err?.message || err);
        return buildQuotationShareLinkJwtFallback(req, quotationId);
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Day-first date + 24h time, e.g. `09/05/2026 20:26`. Mirrors
 * `front/src/lib/dates.js#formatDateTime` so the customer sees an identical
 * format whether they read the React UI or the WhatsApp share page.
 */
function formatQuotationDateTime(d) {
    return formatDateTimeShared(d, '—');
}

async function getCompanyProfileFromSettings() {
    const [nameSetting, addressSetting, logoSetting, contactSetting, whatsappSetting] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: 'company_name' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_address' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_logo' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_contact_number' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_whatsapp_number' } }),
    ]);
    const name = nameSetting?.value && nameSetting.value !== 'false' ? (nameSetting.value || '') : '';
    const address = addressSetting?.value && addressSetting.value !== 'false' ? (addressSetting.value || '') : '';
    const logoUrl = logoSetting?.value && logoSetting.value !== 'false' ? (logoSetting.value || null) : null;
    const contactNumber = contactSetting?.value && contactSetting.value !== 'false' ? (contactSetting.value || '') : '';
    const whatsappNumber = whatsappSetting?.value && whatsappSetting.value !== 'false' ? (whatsappSetting.value || '') : '';
    return { name, address, logoUrl, contactNumber, whatsappNumber };
}

function resolveLogoUrl(logoUrl, baseUrl) {
    if (!logoUrl || logoUrl === 'false') return null;
    if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) return logoUrl;
    return `${baseUrl}${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`;
}

function renderSharedQuotationHtml(quotation, company, baseUrl) {
    const extraCharges = (() => {
        try {
            const arr = JSON.parse(quotation.extraChargesJson || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    })();

    const vehicle = quotation.vehicle;
    const vehLabel = `${vehicle?.vehicleModel?.brand?.name || ''} ${vehicle?.vehicleModel?.name || ''}`.trim();
    const issueDate = new Date(quotation.issueDate);
    const validUntil = new Date(quotation.validUntil);
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

    const rowsHtml = `
      <tr><td>Daily rate × ${Number(quotation.rentalDays || 1)} day(s) @ ${Number(quotation.dailyRate || 0).toLocaleString()} LKR</td><td>${Number(quotation.baseAmount || 0).toLocaleString()}</td></tr>
      ${extraCharges.map((r) => `
      <tr><td>${escapeHtml(r.description || 'Extra charge')}</td><td>${Number(r.amount || 0).toLocaleString()}</td></tr>`).join('')}`;

    const securityDeposit = Number(quotation.securityDeposit || 0);
    const securityRow = securityDeposit > 0
        ? `<tr><td>Security deposit <span style="font-style:italic;color:var(--muted);">(refundable)</span></td><td>${securityDeposit.toLocaleString()}</td></tr>`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(quotation.quotationNo || 'Quotation')}</title>
  <style>${DOCUMENT_PRINT_STYLES}</style>
</head>
<body>
  <div class="doc">
    <div class="doc-topbar"></div>
    <div class="doc-inner">
      ${brandSection}
      <div class="doc-headline">
        <div>
          <div class="doc-kind">Quotation</div>
          <div class="doc-main-id">${escapeHtml(quotation.quotationNo || '')}</div>
          <div class="doc-meta">Issued <b>${escapeHtml(formatQuotationDateTime(issueDate))}</b> · Valid through <b>${escapeHtml(formatQuotationDateTime(validUntil))}</b></div>
        </div>
        <div class="doc-pill doc-pill-em">${Number(quotation.rentalDays || 1)} day rental</div>
      </div>

      <div class="doc-cards">
        <div class="doc-card">
          <div class="doc-card-label">Customer</div>
          <div class="doc-card-value">${escapeHtml(quotation.customerName || '')}</div>
          <div class="doc-card-sub">${escapeHtml(quotation.customerEmail || '—')}</div>
          <div class="doc-chip-row" style="margin-top:10px;"><span class="doc-chip">${escapeHtml(quotation.customerType || '')}</span></div>
        </div>
        <div class="doc-card">
          <div class="doc-card-label">Vehicle</div>
          <div class="doc-card-value">${escapeHtml(vehicle?.licensePlate || '')}</div>
          <div class="doc-card-sub">${escapeHtml(vehLabel)}</div>
        </div>
      </div>

      <div class="doc-card" style="margin-bottom:16px;background:#fff;border-style:dashed;">
        <div class="doc-card-label">Rental period</div>
        <div class="doc-card-value" style="font-size:15px;">
          <div><b>Pick-up:</b> ${escapeHtml(formatQuotationDateTime(quotation.pickupDate))}</div>
          <div><b>Drop-off:</b> ${escapeHtml(formatQuotationDateTime(quotation.dropoffDate))}</div>
        </div>
      </div>

      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Description</th><th>Amount (LKR)</th></tr>
          </thead>
          <tbody>${rowsHtml}${securityRow}</tbody>
          <tfoot>
            <tr><td>Grand total</td><td>${Number(quotation.totalAmount || 0).toLocaleString()}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="doc-foot">
        System-generated quotation — no signature required. Use your browser print dialog to save as PDF if needed.
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

const createQuotationSchema = z.object({
    customerMode: z.enum(['EXISTING', 'NEW']),
    customerId: z.string().optional().nullable(),
    customerName: z.string().min(1),
    customerEmail: z.string().email().optional().nullable(),
    customerType: z.enum(['LOCAL', 'FOREIGN', 'CORPORATE']),
    vehicleId: z.string().min(1),
    pickupDate: z.string().min(1),
    dropoffDate: z.string().min(1),
    rentalDays: z.number().int().min(1),
    dailyRate: z.number().nonnegative(),
    baseAmount: z.number().nonnegative(),
    extraCharges: z.array(z.object({
        description: z.string().optional().nullable(),
        amount: z.number().optional().default(0),
    })).default([]),
    extraAmount: z.number().nonnegative(),
    totalAmount: z.number().nonnegative(),
    /// Refundable security deposit. Included in totalAmount so the customer sees the up-front amount,
    /// but tracked separately so it can be excluded from revenue / P&L downstream (quotations themselves do not hit P&L).
    securityDeposit: z.number().nonnegative().optional().default(0),
});

function buildQuotationNo(sequence, date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `QTN/${m}/${y}/${String(sequence).padStart(5, '0')}`;
}

/** Accepts yyyy-MM-dd (legacy) or full ISO datetime; preserves time when present. */
function parsePickupDropoffDateTime(input) {
    const s = String(input || '').trim();
    if (!s) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

exports.createQuotation = async (req, res) => {
    try {
        const data = createQuotationSchema.parse(req.body || {});
        const issueDate = new Date();
        const validUntil = addDays(issueDate, 7);

        const pickupDate = parsePickupDropoffDateTime(data.pickupDate);
        const dropoffDate = parsePickupDropoffDateTime(data.dropoffDate);

        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);

        const seqKey = `quotation_sequence_${issueDate.getFullYear()}_${String(issueDate.getMonth() + 1).padStart(2, '0')}`;
        const next = await getNextSequenceValue(seqKey);
        const quotationNo = buildQuotationNo(next, issueDate);
        const shareToken = await allocateNewShareToken(db);

        const quotationData = {
            quotation_no: quotationNo,
            issue_date: issueDate,
            valid_until: validUntil,
            customer_mode: data.customerMode,
            customer_id: data.customerMode === 'EXISTING' && data.customerId ? new ObjectId(data.customerId) : null,
            customer_name: data.customerName,
            customer_email: data.customerEmail || null,
            customer_type: data.customerType,
            vehicle_id: new ObjectId(data.vehicleId),
            pickup_date: pickupDate,
            dropoff_date: dropoffDate,
            rental_days: data.rentalDays,
            daily_rate: data.dailyRate,
            base_amount: data.baseAmount,
            extra_charges_json: JSON.stringify(data.extraCharges || []),
            extra_amount: data.extraAmount,
            total_amount: data.totalAmount,
            security_deposit: Number(data.securityDeposit || 0),
            share_token: shareToken,
            created_by_user_id: req.user?.id ? new ObjectId(req.user.id) : null,
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.collection('Quotation').insertOne(quotationData);

        // Fetch the full object with relations using Prisma for consistency
        const created = await prisma.quotation.findUnique({
            where: { id: result.insertedId.toString() },
            include: {
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                customer: true,
            },
        });

        res.status(201).json(created);
    } catch (error) {
        console.error('Create Quotation Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to create quotation' });
    }
};

exports.listQuotations = async (req, res) => {
    try {
        const { search } = req.query;
        const page = parseInt(req.query.page) || 1;
        const requestedLimit = parseInt(req.query.limit) || 20;
        const limit = Math.min(requestedLimit, 100);
        const skip = (page - 1) * limit;

        const where = {};
        if (search) {
            where.OR = [
                { quotationNo: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
                { customerEmail: { contains: search, mode: 'insensitive' } },
                { vehicle: { licensePlate: { contains: search, mode: 'insensitive' } } }
            ];
        }

        const [rows, totalCount] = await Promise.all([
            prisma.quotation.findMany({
                where,
                include: {
                    vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                    customer: true,
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.quotation.count({ where })
        ]);

        const mapped = rows.map((r) => ({
            ...r,
            extraCharges: (() => {
                try {
                    const arr = JSON.parse(r.extraChargesJson || '[]');
                    return Array.isArray(arr) ? arr : [];
                } catch {
                    return [];
                }
            })(),
        }));

        res.json({
            data: mapped,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('List Quotations Error:', error);
        res.status(500).json({ message: 'Failed to fetch quotations' });
    }
};

exports.getQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const row = await prisma.quotation.findUnique({
            where: { id },
            include: {
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                customer: true,
            },
        });
        if (!row) return res.status(404).json({ message: 'Quotation not found' });
        const extraCharges = (() => {
            try {
                const arr = JSON.parse(row.extraChargesJson || '[]');
                return Array.isArray(arr) ? arr : [];
            } catch {
                return [];
            }
        })();
        res.json({ ...row, extraCharges });
    } catch (error) {
        console.error('Get Quotation Error:', error);
        res.status(500).json({ message: 'Failed to fetch quotation' });
    }
};

const sharedQuotationInclude = {
    vehicle: { include: { vehicleModel: { include: { brand: true } } } },
    customer: true,
};

async function sendSharedQuotationPage(req, res, quotation) {
    if (!quotation) {
        return res.status(404).type('text/plain').send('Quotation not found');
    }
    const company = await getCompanyProfileFromSettings();
    const baseUrl = getBackendBaseUrlFromReq(req);
    res.type('text/html').send(renderSharedQuotationHtml(quotation, company, baseUrl));
}

/** Public HTML view — short link: /api/q/:shareToken */
exports.getSharedQuotationByShortToken = async (req, res) => {
    try {
        const raw = String(req.params.shareToken || '').trim();
        if (raw.length < 8 || raw.length > 64) {
            return res.status(404).type('text/plain').send('Not found');
        }
        const quotation = await prisma.quotation.findUnique({
            where: { shareToken: raw },
            include: sharedQuotationInclude,
        });
        return sendSharedQuotationPage(req, res, quotation);
    } catch (error) {
        console.error('Get Shared Quotation (short) Error:', error);
        res.status(500).type('text/plain').send('Failed to load quotation');
    }
};

/** Legacy: long JWT link — /api/quotations/share/:quotationId?token= */
exports.getSharedQuotation = async (req, res) => {
    try {
        const { quotationId } = req.params;
        const { token } = req.query;
        if (!token) return res.status(401).type('text/plain').send('Missing token');

        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).type('text/plain').send('Invalid or expired link');
        }

        if (!payload?.quotationId || payload.quotationId !== quotationId) {
            return res.status(403).type('text/plain').send('Forbidden');
        }

        const quotation = await prisma.quotation.findUnique({
            where: { id: quotationId },
            include: sharedQuotationInclude,
        });
        return sendSharedQuotationPage(req, res, quotation);
    } catch (error) {
        console.error('Get Shared Quotation Error:', error);
        res.status(500).type('text/plain').send('Failed to load quotation');
    }
};

exports.getQuotationShareLink = async (req, res) => {
    try {
        const { id } = req.params;
        const row = await prisma.quotation.findUnique({ where: { id } });
        if (!row) return res.status(404).json({ message: 'Quotation not found' });
        const shareUrl = await buildQuotationShareLink(req, row.id);
        res.json({ shareUrl });
    } catch (error) {
        console.error('Get Quotation Share Link Error:', error);
        const msg =
            error?.message === 'JWT_SECRET is not configured'
                ? 'Server missing JWT_SECRET — cannot generate quotation links'
                : error?.message || 'Failed to generate share link';
        res.status(500).json({ message: msg });
    }
};

