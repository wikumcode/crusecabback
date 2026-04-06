const prisma = require('../lib/prisma');
const billingService = require('../services/billing.service');
const jwt = require('jsonwebtoken');

const BILL_SHARE_TOKEN_TTL = '7d';

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

function buildVendorBillShareLink(req, billId) {
    const token = jwt.sign({ billId }, process.env.JWT_SECRET, { expiresIn: BILL_SHARE_TOKEN_TTL });
    const backendBase = getBackendBaseUrlFromReq(req);
    return `${backendBase}/api/vendor-bills/share/${billId}?token=${encodeURIComponent(token)}`;
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

function renderVendorBillHtml(bill, company) {
    const items = Array.isArray(bill.items) ? bill.items : [];
    const vendorName = bill.vendor?.name || '';
    const vehiclePlate = bill.vehicle?.licensePlate || '';
    const totalAmount = Number(bill.totalAmount || 0);

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const billPeriod = `${monthNames[bill.month - 1]} ${bill.year}`;

    const companyName = company?.name || '';
    const companyAddress = company?.address || '';
    const companyLogoUrl = company?.logoUrl || null;

    const showCompanyBrand = !!companyName.trim();
    const companyLogoHtml = companyLogoUrl
        ? `<img src="${escapeHtml(companyLogoUrl)}" alt="Logo" style="height:52px; width:52px; object-fit:contain; border-radius:10px; background:rgba(255,255,255,0.6);" />`
        : '';
        
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Vendor Bill - ${escapeHtml(bill.billNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
    .muted { color:#555; font-size:12px; }
    table { width:100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border-bottom: 1px solid #ddd; padding: 10px 6px; text-align:left; font-size: 13px; }
    th { font-size: 11px; text-transform: uppercase; color:#444; }
    .right { text-align:right; }
    .total { font-weight: 800; font-size: 16px; }
  </style>
</head>
<body>
  <div style="margin-bottom:18px; display:flex; align-items:center; gap:14px;">
    ${showCompanyBrand ? companyLogoHtml : ''}
    <div>
      <div style="font-weight:900;font-size:20px;">${escapeHtml(companyName)}</div>
      <div class="muted">${escapeHtml(companyAddress)}</div>
    </div>
  </div>

  <div style="display:flex; justify-content:space-between;">
    <div>
      <div style="font-weight:900; font-size:22px;">VENDOR BILL</div>
      <div class="muted">Bill No: <b>${escapeHtml(bill.billNumber)}</b></div>
      <div class="muted">Period: <b>${escapeHtml(billPeriod)}</b></div>
    </div>
    <div style="text-align:right;">
      <div class="muted">Status</div>
      <div style="font-weight:900;">${escapeHtml(bill.status)}</div>
    </div>
  </div>

  <div style="margin-top:18px;">
    <div class="muted">Vendor</div>
    <div style="font-weight:700;">${escapeHtml(vendorName)}</div>
    <div class="muted">Vehicle Plate: <b>${escapeHtml(vehiclePlate)}</b></div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th class="right">Amount (LKR)</th></tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td>${escapeHtml(item.description)}</td>
          <td class="right">${escapeHtml(Number(item.amount).toLocaleString())}</td>
        </tr>
      `).join('')}
      <tr>
        <td class="total">Total Payable</td>
        <td class="total right">${escapeHtml(totalAmount.toLocaleString())}</td>
      </tr>
    </tbody>
  </table>

  <div class="muted" style="margin-top:24px;">
    This is a system-generated settlement bill for vehicle hire and related expenses.
  </div>
</body>
</html>`;
}

const generateBillNumber = async () => {
    const lastBill = await prisma.vendorBill.findFirst({
        where: { billNumber: { startsWith: 'Vendor-Bill/' } },
        orderBy: { billNumber: 'desc' }
    });

    if (!lastBill || !lastBill.billNumber) {
        return 'Vendor-Bill/00001';
    }

    const lastCode = lastBill.billNumber;
    const numberPart = parseInt(lastCode.split('/')[1]);
    const nextNumber = numberPart + 1;
    return `Vendor-Bill/${String(nextNumber).padStart(5, '0')}`;
};

exports.getVendorBills = async (req, res) => {
    try {
        const { vendorId, vehicleId, status, dateRange, filterType } = req.query;

        const now = new Date();
        let start, end;

        if (filterType === 'today') {
            start = new Date(now.setHours(0, 0, 0, 0));
            end = new Date(now.setHours(23, 59, 59, 999));
        } else if (filterType === 'last7days') {
            start = new Date(now.setDate(now.getDate() - 7));
            end = new Date();
        } else if (filterType === 'last30days') {
            start = new Date(now.setDate(now.getDate() - 30));
            end = new Date();
        } else if (dateRange) {
            const [s, e] = JSON.parse(dateRange);
            start = new Date(s);
            end = new Date(e);
        }

        const bills = await prisma.vendorBill.findMany({
            where: {
                ...(vendorId && { vendorId }),
                ...(vehicleId && { vehicleId }),
                ...(status && { status }),
                ...((start && end) && {
                    createdAt: {
                        gte: start,
                        lte: end
                    }
                })
            },
            include: {
                vendor: { 
                    select: { 
                        name: true, 
                        email: true,
                        vendorDetails: { select: { phone: true } }
                    } 
                },
                vehicle: { select: { licensePlate: true, vehicleModel: { include: { brand: true } } } },
                items: true,
                maintenances: true,
                expenses: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Format month name alphabetically for frontend if needed, 
        // though frontend can also handle this with date-fns.
        // We'll keep the raw data but the list view in frontend will format it.
        res.json(bills);
    } catch (error) {
        console.error("Get Vendor Bills Error:", error);
        res.status(500).json({ message: 'Failed to fetch vendor bills' });
    }
};

const fs = require('fs');

exports.createVendorBill = async (req, res) => {
    try {
        const { vendorId, vehicleId, month, year, items, description, monthlyPayment } = req.body;

        const billNumber = await generateBillNumber();

        const totalAmount = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

        const bill = await prisma.vendorBill.create({
            data: {
                billNumber,
                vendor: { connect: { id: vendorId } },
                vehicle: { connect: { id: vehicleId } },
                month: parseInt(month),
                year: parseInt(year),
                monthlyPayment: parseFloat(monthlyPayment) || totalAmount,
                repairDeductions: 0,
                expenseDeductions: 0,
                totalAmount: totalAmount,
                description,
                status: 'PENDING',
                items: {
                    create: items.map(item => ({
                        description: item.description,
                        amount: parseFloat(item.amount)
                    }))
                }
            },
            include: {
                items: true,
                vendor: { 
                    select: { 
                        name: true,
                        vendorDetails: { select: { phone: true } }
                    } 
                },
                vehicle: { select: { licensePlate: true } }
            }
        });

        res.status(201).json(bill);
    } catch (error) {
        const errorDetails = {
            timestamp: new Date().toISOString(),
            body: req.body,
            error: error.message,
            code: error.code,
            meta: error.meta,
            stack: error.stack
        };
        console.error("Create Vendor Bill Error:", error);
        fs.writeFileSync('/tmp/vendor_bill_error.json', JSON.stringify(errorDetails, null, 2));
        res.status(400).json({ message: error.message || 'Failed to create vendor bill' });
    }
};

exports.updateVendorBill = async (req, res) => {
    try {
        const { id } = req.params;
        const { month, year, items, description, monthlyPayment } = req.body;

        // Check if bill exists and is pending
        const existingBill = await prisma.vendorBill.findUnique({ where: { id } });
        if (!existingBill) return res.status(404).json({ message: 'Bill not found' });
        if (existingBill.status !== 'PENDING') return res.status(400).json({ message: 'Only pending bills can be edited' });

        const totalAmount = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

        // Update bill and items using transaction
        const updatedBill = await prisma.$transaction(async (tx) => {
            // Delete existing items
            await tx.vendorBillItem.deleteMany({ where: { vendorBillId: id } });

            // Update main bill and create new items
            return await tx.vendorBill.update({
                where: { id },
                data: {
                    month: parseInt(month),
                    year: parseInt(year),
                    monthlyPayment: parseFloat(monthlyPayment) || totalAmount,
                    totalAmount: totalAmount,
                    description,
                    items: {
                        create: items.map(item => ({
                            description: item.description,
                            amount: parseFloat(item.amount)
                        }))
                    }
                },
                include: { 
                    items: true, 
                    vendor: { 
                        select: { 
                            name: true,
                            vendorDetails: { select: { phone: true } }
                        } 
                    }, 
                    vehicle: { select: { licensePlate: true } } 
                }
            });
        });

        res.json(updatedBill);
    } catch (error) {
        console.error("Update Vendor Bill Error:", error);
        res.status(400).json({ message: error.message || 'Failed to update vendor bill' });
    }
};

exports.generateBills = async (req, res) => {
    try {
        const { month, year, vehicleId } = req.body;
        // Updated service will need to handle sequential numbering too
        const bills = await billingService.generateMonthlyVendorBills(month, year, vehicleId);
        res.json({ message: `Successfully generated ${bills.length} bills`, bills });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to generate bills' });
    }
};

exports.updateBillStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const bill = await prisma.vendorBill.update({
            where: { id },
            data: { status }
        });
        res.json(bill);
    } catch (error) {
        res.status(400).json({ message: 'Failed to update bill status' });
    }
};

exports.getVendorBillShareLink = async (req, res) => {
    try {
        const { id } = req.params;
        const bill = await prisma.vendorBill.findUnique({ where: { id } });
        if (!bill) return res.status(404).json({ message: 'Bill not found' });

        const shareUrl = buildVendorBillShareLink(req, bill.id);
        res.json({ shareUrl });
    } catch (error) {
        console.error('Get Vendor Bill Share Link Error:', error);
        res.status(500).json({ message: 'Failed to generate share link' });
    }
};

exports.getSharedVendorBill = async (req, res) => {
    try {
        const { billId } = req.params;
        const { token } = req.query;
        if (!token) return res.status(401).send('Missing token');

        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return res.status(401).send('Invalid or expired token');
        }

        if (!payload?.billId || payload.billId !== billId) return res.status(403).send('Forbidden');

        const bill = await prisma.vendorBill.findUnique({
            where: { id: billId },
            include: {
                vendor: { select: { name: true } },
                vehicle: { select: { licensePlate: true } },
                items: true
            }
        });

        if (!bill) return res.status(404).send('Bill not found');
        const company = await getCompanyProfileFromSettings();
        res.type('text/html').send(renderVendorBillHtml(bill, company));
    } catch (error) {
        console.error('Get Shared Vendor Bill Error:', error);
        res.status(500).send('Failed to load bill');
    }
};

