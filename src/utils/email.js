const prisma = require('../lib/prisma');
const { sendTemplateEmail } = require('../services/email/email.service');
const { formatDate } = require('../lib/dates');

async function getCompanyName() {
    const row = await prisma.systemSetting.findUnique({ where: { key: 'company_name' } });
    const name = row?.value?.trim();
    return name && name !== 'false' ? name : 'Cruise Cabs';
}

function clientDisplayName(client) {
    if (!client) return 'Customer';
    if (String(client.type || '').toUpperCase() === 'CORPORATE') {
        return client.companyName || client.contactPersonName || client.name || 'Customer';
    }
    return client.name || client.companyName || 'Customer';
}

function formatContractDateTime(dateValue, timeValue) {
    const datePart = formatDate(dateValue, '');
    const timePart = String(timeValue || '').trim();
    if (!datePart) return '—';
    return timePart ? `${datePart} ${timePart}` : datePart;
}

function vehicleLabel(vehicle) {
    if (!vehicle) return '—';
    const brand = vehicle.vehicleModel?.brand?.name || '';
    const model = vehicle.vehicleModel?.name || '';
    const label = `${brand} ${model}`.trim();
    return label || vehicle.licensePlate || '—';
}

function moneyLKR(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-LK') : '0';
}

function invoiceLinkBlock(link) {
    const url = String(link || '').trim();
    if (!url) return '';
    return `
      <p style="margin-top:16px;">
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700;">
          View invoice
        </a>
      </p>
      <p style="font-size:12px;color:#666;margin-top:16px;">
        If the button does not work, copy this link into your browser:<br/>
        <span style="word-break:break-all;">${url}</span>
      </p>`;
}

function receiptLinkBlock(link) {
    const url = String(link || '').trim();
    if (!url) return '';
    return `
      <p style="margin-top:16px;">
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700;">
          View advance receipt
        </a>
      </p>
      <p style="font-size:12px;color:#666;margin-top:16px;">
        If the button does not work, copy this link into your browser:<br/>
        <span style="word-break:break-all;">${url}</span>
      </p>`;
}

async function sendTemplateEmailSafe(templateKey, to, variables = {}) {
    const email = String(to || '').trim();
    if (!email) return;
    try {
        const companyName = await getCompanyName();
        await sendTemplateEmail(templateKey, email, {
            company_name: companyName,
            ...variables,
        });
    } catch (error) {
        console.error(`Email [${templateKey}] failed:`, error?.message || error);
    }
}

exports.sendWelcomeEmail = async (email, name, customerCode = '') => {
    await sendTemplateEmailSafe('WELCOME', email, {
        customer_name: name || 'Customer',
        customer_code: customerCode || '—',
    });
};

exports.sendVendorWelcomeEmail = async (email, { name, vendorCode, temporaryPassword }) => {
    const passwordBlock = temporaryPassword
        ? `<p><b>Temporary password:</b> ${temporaryPassword}<br/><span style="font-size:12px;color:#666;">Please change this after your first login.</span></p>`
        : '<p>Use the password provided by your administrator to sign in.</p>';
    await sendTemplateEmailSafe('VENDOR_WELCOME', email, {
        vendor_name: name || 'Vendor',
        vendor_code: vendorCode || '—',
        vendor_email: email,
        password_block: passwordBlock,
    });
};

exports.sendContractCreatedEmail = async (contract) => {
    const customer = contract?.customer;
    const email = customer?.email;
    if (!email) return;
    await sendTemplateEmailSafe('CONTRACT_CREATED', email, {
        customer_name: clientDisplayName(customer),
        contract_no: contract.contractNo || '—',
        vehicle_label: vehicleLabel(contract.vehicle),
        pickup_datetime: formatContractDateTime(contract.pickupDate, contract.pickupTime),
        dropoff_datetime: formatContractDateTime(contract.dropoffDate, contract.dropoffTime),
        daily_rate: moneyLKR(contract.appliedDailyRate),
        advance_amount: moneyLKR(contract.advancePaymentAmount),
        allocated_km: String(contract.allocatedKm ?? '—'),
    });
};

exports.sendAdvanceReceiptEmail = async (receipt, shareUrl) => {
    const customer = receipt?.contract?.customer;
    const email = customer?.email;
    if (!email) return;
    await sendTemplateEmailSafe('ADVANCE_RECEIPT_SENT', email, {
        customer_name: clientDisplayName(customer),
        receipt_no: receipt.receiptNo || '—',
        contract_no: receipt.contract?.contractNo || '—',
        receipt_amount: moneyLKR(receipt.amount),
        receipt_link_block: receiptLinkBlock(shareUrl),
    });
};

exports.sendInvoiceEmail = async (invoice, shareUrl, invoiceTypeLabel = 'Invoice') => {
    const customer = invoice?.customer;
    const email = customer?.email;
    if (!email) return;
    const type = String(invoiceTypeLabel || 'Invoice');
    await sendTemplateEmailSafe('INVOICE_SENT', email, {
        customer_name: clientDisplayName(customer),
        invoice_type: type,
        invoice_no: invoice.invoiceNo || '—',
        contract_no: invoice.contract?.contractNo || '—',
        invoice_total: moneyLKR(invoice.total),
        invoice_link_block: invoiceLinkBlock(shareUrl),
    });
};

exports.sendContractThankYouEmail = async (contract) => {
    const customer = contract?.customer;
    const email = customer?.email;
    if (!email) return;
    await sendTemplateEmailSafe('CONTRACT_THANK_YOU', email, {
        customer_name: clientDisplayName(customer),
        contract_no: contract.contractNo || '—',
    });
};

exports.sendCreditNoteEmail = async (customer, { creditNoteNo, referenceNo, amount, reason }) => {
    const email = customer?.email;
    if (!email) return;
    const reasonBlock = reason
        ? `<p><b>Reason:</b> ${reason}</p>`
        : '';
    await sendTemplateEmailSafe('CREDIT_NOTE_ISSUED', email, {
        customer_name: clientDisplayName(customer),
        credit_note_no: creditNoteNo || '—',
        reference_no: referenceNo || '—',
        credit_amount: moneyLKR(amount),
        reason_block: reasonBlock,
    });
};
