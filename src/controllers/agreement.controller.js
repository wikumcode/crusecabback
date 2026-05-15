const crypto = require('crypto');
const prisma = require('../lib/prisma');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { getMongoClient, getNextSequenceValue } = require('../utils/sequence');
const { DOCUMENT_PRINT_STYLES } = require('../lib/documentPrintStyles');
const { formatDate } = require('../lib/dates');

const AGREEMENT_SEQ_KEY = 'agreement_sequence';
const AGREEMENT_SHARE_TOKEN_TTL = '7d';
// Unambiguous base-58-ish alphabet (no 0/O/1/l) — keeps tokens easy to read in chats.
const SHARE_TOKEN_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function pad(num, size) {
    const s = String(num);
    return s.length >= size ? s : '0'.repeat(size - s.length) + s;
}

function buildAgreementNo(sequence, date = new Date()) {
    const year = date.getFullYear();
    return `AGR-${year}-${pad(sequence, 5)}`;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function randomShareTokenChars(length = 12) {
    let out = '';
    for (let i = 0; i < length; i++) {
        out += SHARE_TOKEN_CHARS[crypto.randomInt(0, SHARE_TOKEN_CHARS.length)];
    }
    return out;
}

/**
 * Lazily allocate a short opaque shareToken on an agreement.
 * Uses a partial unique index (see `ensure-agreement-share-token-index.js`)
 * so missing/null tokens don't collide with each other.
 */
async function ensureAgreementShareToken(agreementId) {
    const existing = await prisma.agreement.findUnique({
        where: { id: agreementId },
        select: { shareToken: true },
    });
    if (!existing) return null;
    if (existing.shareToken) return existing.shareToken;

    for (let attempt = 0; attempt < 8; attempt++) {
        const token = randomShareTokenChars(12);
        // Collision check against the partial unique index. We use findFirst
        // because shareToken is intentionally not declared `@unique` in the
        // Prisma schema (see schema.prisma comment).
        const clash = await prisma.agreement.findFirst({
            where: { shareToken: token },
            select: { id: true },
        });
        if (clash) continue;
        try {
            await prisma.agreement.update({
                where: { id: agreementId },
                data: { shareToken: token },
            });
            return token;
        } catch (e) {
            if (e?.code === 'P2002') continue;
            throw e;
        }
    }
    throw new Error('Failed to allocate agreement share token');
}

function getBackendBaseUrlFromReq(req) {
    if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
    const protocol = req.protocol || 'https';
    const host = req.headers.host;
    if (host) return `${protocol}://${host}`;
    return 'http://localhost:5000';
}

function buildAgreementShareLinkJwtFallback(req, agreementId) {
    const token = jwt.sign({ agreementId }, process.env.JWT_SECRET, { expiresIn: AGREEMENT_SHARE_TOKEN_TTL });
    const backendBase = getBackendBaseUrlFromReq(req);
    return `${backendBase}/api/agreements/share/${agreementId}?token=${encodeURIComponent(token)}`;
}

/**
 * Prefer the short `/api/a/:shareToken` URL. Falls back to the legacy signed
 * JWT URL only if token allocation fails (e.g. the partial-unique index has
 * not been provisioned yet on this environment).
 */
async function buildAgreementShareLink(req, agreementId) {
    try {
        const shareToken = await ensureAgreementShareToken(agreementId);
        if (!shareToken) throw new Error('Agreement not found');
        const backendBase = getBackendBaseUrlFromReq(req);
        return `${backendBase}/api/a/${shareToken}`;
    } catch (err) {
        console.warn('Short agreement share link unavailable, using JWT fallback:', err?.message || err);
        return buildAgreementShareLinkJwtFallback(req, agreementId);
    }
}

async function getCompanyProfileFromSettings() {
    const [nameSetting, addressSetting, logoSetting, contactSetting, websiteSetting, emailSetting] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: 'company_name' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_address' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_logo' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_contact_number' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_website' } }),
        prisma.systemSetting.findUnique({ where: { key: 'company_email' } }),
    ]);

    return {
        name: nameSetting?.value && nameSetting.value !== 'false' ? (nameSetting.value || '') : '',
        address: addressSetting?.value && addressSetting.value !== 'false' ? (addressSetting.value || '') : '',
        logoUrl: logoSetting?.value && logoSetting.value !== 'false' ? (logoSetting.value || null) : null,
        contactNumber: contactSetting?.value && contactSetting.value !== 'false' ? (contactSetting.value || '') : '',
        website: websiteSetting?.value && websiteSetting.value !== 'false' ? (websiteSetting.value || '') : '',
        email: emailSetting?.value && emailSetting.value !== 'false' ? (emailSetting.value || '') : '',
    };
}

function buildAgreementData(contract, company) {
    const contractDate = contract?.pickupDate ? new Date(contract.pickupDate) : new Date();
    const day = contractDate.getDate();
    const month = contractDate.toLocaleString('en-US', { month: 'long' });
    const year = contractDate.getFullYear();
    const fromDate = contract?.pickupDate ? formatDate(contract.pickupDate, '') : '';
    const toDate = contract?.dropoffDate ? formatDate(contract.dropoffDate, '') : '';
    // Rental duration in whole days, mirroring the calculation used by
    // `contractController.js` and `invoice.controller.js` so the agreement
    // shows exactly the same day count the customer was billed for.
    let days = 0;
    if (contract?.pickupDate && contract?.dropoffDate) {
        const ms = new Date(contract.dropoffDate).getTime() - new Date(contract.pickupDate).getTime();
        days = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
    }
    const secondPartyName = contract?.customer?.name || contract?.customer?.companyName || '';
    const secondPartyAddress = contract?.customer?.address || '';
    const secondPartyNic = contract?.customer?.nicOrPassport || contract?.customer?.passportNo || '';
    const secondPartyLicense = contract?.customer?.drivingLicenseNo || '';

    return {
        company,
        contractNo: contract?.contractNo || '',
        contractDate: { day, month, year, iso: contractDate.toISOString() },
        term: { fromDate, toDate, days },
        secondParty: {
            name: secondPartyName,
            address: secondPartyAddress,
            nic: secondPartyNic,
            drivingLicenseNo: secondPartyLicense,
        },
        vehicle: {
            number: contract?.vehicle?.licensePlate || '',
            odometerStart: Number(contract?.startOdometer || 0),
            brand: contract?.vehicle?.vehicleModel?.brand?.name || '',
            model: contract?.vehicle?.vehicleModel?.name || '',
        },
        financials: {
            dailyRate: Number(contract?.appliedDailyRate || 0),
            securityDeposit: Number(contract?.securityDeposit || 0),
            deliveryCharge: Number(contract?.deliveryCharge || 0),
            collectionCharge: Number(contract?.collectionCharge || 0),
            allocatedKm: Number(contract?.allocatedKm || 0),
            extraMileageCharge: Number(contract?.extraMileageCharge || 0),
        },
    };
}

function renderAgreementHtml(agreement) {
    const d = agreement?.data || {};
    const company = d.company || {};
    const secondParty = d.secondParty || {};
    const vehicle = d.vehicle || {};
    const financials = d.financials || {};
    const contractDate = d.contractDate || {};
    const term = d.term || {};

    const line = (val, min = 160) => `<span class="line" style="min-width:${min}px;">${escapeHtml(val || '')}</span>`;
    const dateLine = `${line(contractDate.day, 48)}day of${line(contractDate.month, 120)}, ${line(contractDate.year, 70)}`;

    // Resolve the rental day count for point 8. Newly generated agreements
    // store this in `data.term.days`; older snapshots only have the formatted
    // `fromDate` / `toDate` strings, so we re-parse them as a fallback so the
    // pre-fill also works for already-issued agreements.
    let rentalDays = Number(term.days || 0);
    if (!rentalDays && term.fromDate && term.toDate) {
        const parseDmy = (s) => {
            const [dd, mm, yyyy] = String(s).split('/').map((p) => parseInt(p, 10));
            if (!dd || !mm || !yyyy) return null;
            return new Date(yyyy, mm - 1, dd);
        };
        const from = parseDmy(term.fromDate);
        const to = parseDmy(term.toDate);
        if (from && to) {
            rentalDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
        }
    }
    const rentalDaysLabel = rentalDays > 0 ? String(rentalDays) : '';
    const firstPartyName = company.name || '';
    const companyAddress = company.address || '';
    const companyWebsite = company.website || '';
    const companyEmail = company.email || '';
    const companyHotline = company.contactNumber || '';
    const dateForSign = term.fromDate || `${contractDate.day || ''}/${contractDate.month || ''}/${contractDate.year || ''}`;
    const pageStart = (pageNo) => `
      <div class="page">
        <div class="page-no">${pageNo}</div>
        <div class="doc-header">
          <div>${escapeHtml(firstPartyName)}</div>
          <div>${escapeHtml(companyHotline)} | ${escapeHtml(companyEmail)}</div>
        </div>
    `;
    const pageEnd = (pageNo) => `
        <div class="doc-footer">
          <div>
            <span>${escapeHtml(agreement.agreementNo || '')}</span><br/>
            <span style="font-size: 9px; opacity: 0.9; font-weight: bold;">Powered by Rentix | www.codebraze.lk</span>
          </div>
          <span>Page ${pageNo} of 4</span>
        </div>
      </div>
    `;

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(agreement.agreementNo || 'Agreement')}</title>
    <style>
    @page { size: A4 portrait; margin: 0; }
    html, body { margin:0; padding:0; }
    body {
      font-family: "Times New Roman", serif;
      color:#111;
      line-height:1.4;
      font-size:16px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      height: 297mm;
      margin: 0 auto;
      padding: 14mm 10mm 12mm;
      box-sizing:border-box;
      position:relative;
      page-break-after: always;
      overflow: hidden;
    }
    .page:last-child { page-break-after: auto; }
    .page-no { position:absolute; top:6mm; left:7mm; font-size:11px; }
    .doc-header {
      display:flex;
      justify-content:space-between;
      align-items:center;
      border-bottom:2px solid #3B82F6;
      padding-bottom:2mm;
      margin-bottom:4mm;
      font-size:12px;
      color: #3B82F6;
      font-weight: 700;
    }
    .doc-footer {
      position:absolute;
      left:10mm;
      right:10mm;
      bottom:6mm;
      display:flex;
      justify-content:space-between;
      font-size:11px;
      border-top:1px solid #3B82F6;
      padding-top:2mm;
      color: #64748b;
    }
    .title { text-align:center; font-size:34px; font-weight:700; text-decoration:underline; margin: 7mm 0 7mm; color: #1e3a8a; }
    .line { border-bottom: 1px solid #111; display:inline-block; vertical-align:bottom; min-height:14px; padding: 0 2px; }
    .para { margin: 6px 0; }
    .dots { margin: 5px 0 5px 24px; }
    .footer-meta { margin-top: 10px; font-size: 13px; }
    .logo { width:64px; height:64px; object-fit:contain; vertical-align:top; margin-right:12px; border-radius: 8px; }
    .tight { margin:2px 0; }
    @media print {
      body { font-size:15.6px; line-height:1.36; }
      .page { box-shadow:none; }
    }
  </style>
</head>
<body>
  ${pageStart(1)}
    <div class="para" style="display:flex;align-items:flex-start;gap:12px;">
      ${company.logoUrl ? `<img class="logo" src="${escapeHtml(company.logoUrl)}" alt="logo" />` : ''}
      <div style="font-size:16px;">
        <div class="tight">Address :${escapeHtml(companyAddress)}</div>
        <div class="tight">Website :${escapeHtml(companyWebsite)}</div>
        <div class="tight">E mail : ${escapeHtml(companyEmail)}</div>
        <div class="tight">Hotline : ${escapeHtml(companyHotline)}</div>
      </div>
    </div>
    <div class="title">Vehicle Rental Agreement</div>
    <div class="para">This Vehicle Rental Agreement ("Agreement") is made and entered into on this ${dateLine}, by and between:</div>
    <div class="para"><b>First Party:</b> ${escapeHtml(firstPartyName)}</div>
    <div class="para"><b>Second Party:</b> Mr./Ms. ${line(secondParty.name)}</div>
    <div class="para">Address: ${line(secondParty.address, 260)}</div>
    <div class="para">National ID Number: ${line(secondParty.nic, 180)}</div>
    <div class="para">Driving License Number: ${line(secondParty.drivingLicenseNo, 180)}</div>
    <div class="para"><b>Vehicle Details:</b> Vehicle Number: ${line(vehicle.number, 180)}</div>
    <div class="para">Odometer Reading at Start: ${line(vehicle.odometerStart, 180)}</div>
    <div class="para"><b>1. Term</b> This Agreement is valid from ${line(term.fromDate, 170)} to ${line(term.toDate, 170)}.</div>
    <div class="para"><b>2. Late Return Charges / Extension</b> If the Second Party uses the vehicle beyond the term of this Agreement, the following additional rent will be charged and the first party should be informed and should obtain the approval of the first party.</div>
    <div class="para"><b>3. Early Termination</b> If the Second Party terminates this Agreement before the end of the term, they must provide at least ${line('', 120)} days' notice. If notice is not given, Rs. ${line('', 120)} will be charged.</div>
    <div class="para"><b>4. Deposit and Damages</b> At the beginning of the Agreement, the Second Party shall pay a deposit of Rs. ${line(Number(financials.securityDeposit || 0).toLocaleString(), 140)}. Any damages caused by the Second Party or third parties will be deducted from this deposit. Damages by third parties will be deducted upon return of the deposit.</div>
    <div class="para"><b>5. Vehicle Cleaning</b> The Second Party must wash and vacuum the vehicle from a service station before returning it. Failure to do so will result in a charge of Rs. 1,000.</div>
    <div class="para"><b>6. Refund of Deposit</b> If the vehicle is returned clean, with no damage or error indicators, the deposit will be refunded immediately after a comprehensive checkup. This process may take up to 24 hours.</div>
  ${pageEnd(1)}

  ${pageStart(2)}
    <div class="para"><b>7. Refund Methods</b> For Sri Lankan nationals, the deposit will be transferred to: Account Holder: ${line('', 220)}</div>
    <div class="para">Account Number: ${line('', 220)}</div>
    <div class="para">Branch Name: ${line('', 220)}</div>
    <div class="para">Bank Name: ${line('', 220)}</div>
    <div class="para">For other nationalities, the deposit will be refunded in cash or transfer back to the credit card.</div>
    <div class="para"><b>8. Initial Payments</b> Upon signing this Agreement, the Second Party must pay the deposit of Rs. ${line(Number(financials.securityDeposit || 0).toLocaleString(), 140)} and the total rental amount of Rs. ${line(Number(financials.dailyRate || 0).toLocaleString(), 140)} for the period of ${line(rentalDaysLabel, 130)} (days/weeks/months) and the delivery and pick up fee ${line(Number((financials.deliveryCharge || 0) + (financials.collectionCharge || 0)).toLocaleString(), 120)} to the First Party.</div>
    <div class="para"><b>9. Long-Term Contracts</b> For contracts exceeding 6 months, the starting date will be considered as the first day. Payments should be made before ${line('28th', 120)} of each month, calculated from the date of vehicle delivery.</div>
    <div class="para"><b>10. Mileage Limit</b> The Second Party is entitled to a maximum mileage of ${line(Number(financials.allocatedKm || 0).toLocaleString(), 140)} kilometers. For each kilometer exceeding this limit, an extra charge of Rs. ${line(Number(financials.extraMileageCharge || 0).toLocaleString(), 140)} per kilometer will apply.</div>
    <div class="para"><b>11. Mileage Notification</b> The Second Party must inform the First Party upon exceeding the mileage limit and pay in advance for additional mileage units.</div>
    <div class="para"><b>12. Authorized Drivers</b> The vehicle may only be driven by the Second Party or approved agents with proper documentation provided to the 1st party.</div>
    <div class="para"><b>13. Addition of New Drivers</b> Adding a new driver will incur a charge of Rs.10,000</div>
    <div class="para">Mr./Ms. ${line('', 220)}</div>
    <div class="para">Address: ${line('', 260)}</div>
    <div class="para">National ID Number: ${line('', 180)}</div>
    <div class="para">Driving License Number: ${line('', 180)}</div>
    <div class="para"><b>14. Unauthorized Drivers</b> If the vehicle is driven by anyone other than approved persons, the First Party reserves the right to terminate the Agreement and recall the vehicle immediately. If an accident occurs by an unauthorized driver, the first party remains the right to recall the vehicle, seize the deposit and to cover up any charges which will not be paid by the insurance from the second party.</div>
    <div class="para"><b>15. Vehicle Inspection</b> The Second Party must allow the First Party to inspect the vehicle upon providing prior notice. However, if the vehicle is found to be used recklessly, resulting in excessive body damage, scratches, or damage to the interior, the First Party reserves the right to immediately recall the vehicle and terminate the Agreement without prior notice.</div>
    <div class="para"><b>16. Parking Safety</b> The Second Party must park the vehicle in a secure environment. Failure to do so gives the First Party the right to cancel the Agreement and recall the vehicle immediately.</div>
  ${pageEnd(2)}

  ${pageStart(3)}
    <div class="para"><b>17. Accident Reporting</b> In the event of an accident, the Second Party must notify the First Party before contacting the insurance company. If required, the Second Party must file a police report without delay. Failure to do so may result in the insurance claim being rejected, and the Second Party will be liable for repair costs.</div>
    <div class="para"><b>18. Accident Damages</b> The First Party will claim insurance for damages exceeding Rs. 40,000. The Second Party shall be fully responsible for all damages below Rs. 40,000. In the event of an accident caused by the negligence or fault of the Second Party.</div>
    <div class="para"><b>19. Negligence and Repair Costs</b> If an accident occurs due to the Second Party's negligence, 2nd party will be liable (pay the daily rent to the 1st party) for the period required for vehicle repairs. If the 2nd party uses the vehicle in a way where insurance cannot be obtained, 2nd party should pay the compensation for the damage personally to the 1st party.</div>
    <div class="para"><b>20. Excess Accident Costs</b> In the event of an accident, the Second Party shall be responsible for paying any excess accident costs, including insurance deductibles, amounts not covered by insurance, and any additional charges arising from the accident. Such excess must be settled by the Second Party in full upon request by the First Party.</div>
    <div class="para"><b>21. Legal Compliance</b> The Second Party agrees to drive the vehicle according to Sri Lankan law and not use it for illegal activities.</div>
    <div class="para"><b>22. Responsibility</b> The vehicle must not be used for any illegal activity or in any manner that violates the ownership rights of the First Party. The Second Party is fully responsible for the vehicle during the rental period and shall bear all legal fees and rental payments if the vehicle is seized by the authorities for unlawful activities. If the Second Party uses the vehicle in a way that invalidates insurance coverage, the Second Party shall personally compensate the First Party in full for all damages incurred.</div>
    <div class="para">The Second Party is also responsible for running the vehicle for a minimum of 15 minutes if it has been idle for more than 24 hours, and for promptly informing the First Party of any warning signs or issues appearing in the vehicle.</div>
    <div class="para"><b>23. Unattended Vehicle Fee</b> If the vehicle is left unattended (ex-if the 2nd party leave the vehicle on the road or in a hotel or a house without informing the 1st party) or in an accident, the Second Party must pay Rs. ${line('15,000/-', 150)} per day to the First Party.</div>
    <div class="para"><b>24. Substitute Vehicle</b> A substitute vehicle may be provided in the event of an accident or mechanical breakdown not caused by the negligence or misuse of the Second Party. The Second Party agrees to pay any additional costs for substitution due to accidents. No substitute vehicle will be provided if the accident results from the reckless or negligent driving of the Second Party.</div>
    <div class="para"><b>25. Minor Repairs</b> The Second Party will bear the cost of minor repairs up to Rs. ${line('10,000/-', 150)} Costs exceeding this amount will be borne by the First Party.</div>
    <div class="para"><b>26. Service and Maintenance</b> The Second Party must return the vehicle for service and maintenance. If the first party does not return the vehicle on the same day, a substitute vehicle may be provided based on availability, or the daily rental cost will not be deducted.</div>
  ${pageEnd(3)}

  ${pageStart(4)}
    <div class="para"><b>27. Internal Damage</b> The Second Party will bear the cost of damages to internal parts caused by careless use during the rental period.</div>
    <div class="para"><b>28. Regular Maintenance Checks</b> The Second Party must regularly check air pressure, coolant levels, and oil levels. Costs from running the vehicle without these checks will be borne by the Second Party.</div>
    <div class="para"><b>29. Duration</b> For the purposes of this Agreement, a month shall be calculated as thirty (30) days.</div>
    <div class="para">The standard vehicle pickup time shall be 8:00 AM, and the return time shall be 5:00 PM, during daylight hours, unless a different schedule is agreed upon in advance between the First Party and the Second Party.</div>
    <div class="para"><b>30. Purpose</b> The vehicle should be used by the 2nd party for passenger transportation purposes only (but not for goods transportation) and should avoid overloading.</div>
    <div class="para" style="margin-top:12px;"><b>Signatures:</b></div>
    <div class="para"><b>First Party:</b></div>
    <div class="para">Signature: ${line('', 180)}</div>
    <div class="para">Name: ${line('', 180)}</div>
    <div class="para">Title: ${line('', 180)}</div>
    <div class="para" style="margin-top:8px;"><b>Second Party:</b></div>
    <div class="para">Signature: ${line('', 180)}</div>
    <div class="para">Name: ${line(secondParty.name, 180)}</div>
    <div class="para">Date: ${line(dateForSign, 180)}</div>
    <div class="para" style="margin-top:8px;"><b>Guarantor:</b></div>
    <div class="para">Signature: ${line('', 180)}</div>
    <div class="para">Name & N.I.C No: ${line('', 220)}</div>
    <div class="para">Contact No & Address: ${line('', 260)}</div>
    <div class="para" style="margin-top:8px;"><b>1st Party Witness:</b></div>
    <div class="para">Signature: ${line('', 180)}</div>
    <div class="para">Name: ${line('', 180)}</div>
    <div class="para">Date: ${line('', 180)}</div>
    <div class="para" style="margin-top:8px;"><b>Second Party Witness:</b></div>
    <div class="para">Signature: ${line('', 180)}</div>
    <div class="para">Name: ${line('', 180)}</div>
    <div class="para">Date: ${line('', 180)}</div>
    <div class="para" style="margin-top:10px;">By signing below, both parties agree to the terms and conditions outlined in this Agreement.</div>
    <div class="para"><b>Date:</b> ${line(dateForSign, 200)}</div>
  ${pageEnd(4)}
</body>
</html>`;
}

exports.listAgreements = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const skip = (page - 1) * limit;

        const [agreements, totalCount] = await Promise.all([
            prisma.agreement.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    contract: true,
                    customer: true,
                    vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                },
                skip,
                take: limit
            }),
            prisma.agreement.count()
        ]);

        res.json({
            data: agreements,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('List Agreements Error:', error);
        res.status(500).json({ message: 'Failed to fetch agreements' });
    }
};

exports.getAgreement = async (req, res) => {
    try {
        const { id } = req.params;
        const agreement = await prisma.agreement.findUnique({
            where: { id },
            include: {
                contract: true,
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
            },
        });
        if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
        res.json(agreement);
    } catch (error) {
        console.error('Get Agreement Error:', error);
        res.status(500).json({ message: 'Failed to fetch agreement' });
    }
};

exports.getAgreementByContract = async (req, res) => {
    try {
        const { contractId } = req.params;
        const agreement = await prisma.agreement.findUnique({
            where: { contractId },
            include: {
                contract: true,
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
            },
        });
        if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
        res.json(agreement);
    } catch (error) {
        console.error('Get Agreement By Contract Error:', error);
        res.status(500).json({ message: 'Failed to fetch agreement' });
    }
};

exports.createAgreementForContract = async (req, res) => {
    try {
        const { contractId } = req.params;
        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
            },
        });
        if (!contract) return res.status(404).json({ message: 'Contract not found' });
        const allowedStatuses = ['UPCOMING', 'IN_PROGRESS'];
        if (!allowedStatuses.includes(contract.status)) {
            return res.status(400).json({ message: `Agreement can only be generated when contract is UPCOMING or IN_PROGRESS (current: ${contract.status})` });
        }

        const company = await getCompanyProfileFromSettings();
        const data = buildAgreementData(contract, company);

        // Setup native driver — avoids P2031 on standalone MongoDB
        const mClient = await getMongoClient();
        const dbName = process.env.DATABASE_URL.split('/').pop().split('?')[0];
        const db = mClient.db(dbName);
        const agreementCollection = db.collection('Agreement');

        // Check for an existing agreement for this contract
        const existing = await prisma.agreement.findUnique({ where: { contractId } });

        if (existing) {
            // Update existing — native driver write
            await agreementCollection.updateOne(
                { _id: new ObjectId(existing.id) },
                { $set: { data, status: 'GENERATED', updatedAt: new Date() } }
            );

            const updated = await prisma.agreement.findUnique({
                where: { id: existing.id },
                include: {
                    contract: true,
                    customer: true,
                    vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                },
            });
            return res.json(updated);
        }

        // Allocate sequence number via unified Prisma utility
        const next = await getNextSequenceValue(AGREEMENT_SEQ_KEY);
        const agreementNo = buildAgreementNo(next, new Date());

        // Insert new agreement using native driver
        const insertResult = await agreementCollection.insertOne({
            agreementNo,
            sequence: next,
            contractId: new ObjectId(contractId),
            customerId: new ObjectId(contract.customerId),
            vehicleId: new ObjectId(contract.vehicleId),
            data,
            status: 'GENERATED',
            shareToken: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Fetch the newly created agreement with full relations via Prisma (read-only, safe)
        const agreement = await prisma.agreement.findUnique({
            where: { id: insertResult.insertedId.toString() },
            include: {
                contract: true,
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
            },
        });

        res.status(201).json(agreement);
    } catch (error) {
        console.error('Create Agreement Error:', error);
        res.status(500).json({ message: error.message || 'Failed to create agreement' });
    }
};

exports.getAgreementShareLink = async (req, res) => {
    try {
        const { id } = req.params;
        const agreement = await prisma.agreement.findUnique({ where: { id } });
        if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
        const shareUrl = await buildAgreementShareLink(req, agreement.id);
        res.json({ shareUrl });
    } catch (error) {
        console.error('Get Agreement Share Link Error:', error);
        res.status(500).json({ message: 'Failed to generate share link' });
    }
};

/**
 * Render an agreement as an HTML page (for browser preview or print).
 * Shared by both the legacy long URL (`/api/agreements/share/:id?token=...`)
 * and the short URL (`/api/a/:shareToken`).
 */
async function sendAgreementHtml(req, res, agreement) {
    // Fallback: if older agreement snapshot has no company/logo, use current settings.
    const currentCompany = await getCompanyProfileFromSettings();
    const agreementForRender = {
        ...agreement,
        data: {
            ...(agreement.data || {}),
            company: {
                ...(agreement.data?.company || {}),
                ...currentCompany,
            },
        },
    };

    const html = renderAgreementHtml(agreementForRender);
    const shouldPrint = String(req.query?.download || '').toLowerCase() === '1';
    if (!shouldPrint) {
        return res.type('text/html').send(html);
    }

    const printInjectedHtml = html.replace(
        '</body>',
        `<script>
                function waitForImages() {
                    var images = Array.prototype.slice.call(document.images || []);
                    if (!images.length) return Promise.resolve();
                    return Promise.all(images.map(function (img) {
                        if (img.complete) return Promise.resolve();
                        return new Promise(function (resolve) {
                            img.onload = resolve;
                            img.onerror = resolve;
                        });
                    }));
                }

                window.addEventListener('load', function () {
                    waitForImages().then(function () {
                        setTimeout(function () {
                            window.print();
                        }, 250);
                    });
                });
            </script></body>`
    );
    return res.type('text/html').send(printInjectedHtml);
}

/** Public HTML view — short link: /api/a/:shareToken */
exports.getSharedAgreementByShortToken = async (req, res) => {
    try {
        const raw = String(req.params.shareToken || '').trim();
        if (!raw) return res.status(400).send('Missing share token');
        const agreement = await prisma.agreement.findFirst({
            where: { shareToken: raw },
        });
        if (!agreement) return res.status(404).send('Agreement not found');
        return sendAgreementHtml(req, res, agreement);
    } catch (error) {
        console.error('Get Shared Agreement (short) Error:', error);
        res.status(500).send('Failed to load agreement');
    }
};

/** Legacy: long JWT link — /api/agreements/share/:agreementId?token= */
exports.getSharedAgreement = async (req, res) => {
    try {
        const { agreementId } = req.params;
        const { token } = req.query;
        if (!token) return res.status(401).send('Missing token');
        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).send('Invalid or expired token');
        }
        if (!payload?.agreementId || payload.agreementId !== agreementId) return res.status(403).send('Forbidden');

        const agreement = await prisma.agreement.findUnique({ where: { id: agreementId } });
        if (!agreement) return res.status(404).send('Agreement not found');
        return sendAgreementHtml(req, res, agreement);
    } catch (error) {
        console.error('Get Shared Agreement Error:', error);
        res.status(500).send('Failed to load agreement');
    }
};

