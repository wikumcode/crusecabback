/**
 * Shared customer block for printable/share documents (quotation, invoice, receipts, credit notes).
 * Keep in sync with front/src/lib/documentCustomerCard.js
 */

function resolveClientContact(client) {
    if (!client) {
        return { name: '', phone: '', email: '', address: '', type: '' };
    }
    const type = String(client.type || '').trim();
    const name = type === 'CORPORATE'
        ? (client.companyName || client.contactPersonName || client.name || '')
        : (client.name || client.companyName || '');
    const phone = (
        client.mobile ||
        client.phone ||
        client.contactPersonMobile ||
        ''
    ).trim();
    const email = (client.email || '').trim();
    const address = (client.address || '').trim();
    return { name, phone, email, address, type };
}

function resolveQuotationCustomerContact(quotation) {
    const fromClient = resolveClientContact(quotation?.customer);
    return {
        name: quotation?.customerName || fromClient.name,
        phone: quotation?.customerPhone || fromClient.phone,
        email: quotation?.customerEmail || fromClient.email,
        address: quotation?.customerAddress || fromClient.address,
        type: quotation?.customerType || fromClient.type,
    };
}

function renderDocumentCustomerCardHtml(contact, escapeHtml) {
    const e = escapeHtml;
    const typeChipRow = contact.type
        ? `<div class="doc-chip-row" style="margin-top:10px;"><span class="doc-chip">${e(contact.type)}</span></div>`
        : '';
    const addressHtml = e(contact.address || '—').replace(/\n/g, '<br/>');
    return `
        <div class="doc-card">
          <div class="doc-card-label">Customer</div>
          <div class="doc-card-value">${e(contact.name || '—')}</div>
          <div class="doc-card-sub"><b>Address:</b> ${addressHtml}</div>
          <div class="doc-card-sub"><b>Mobile:</b> ${e(contact.phone || '—')}</div>
          <div class="doc-card-sub"><b>Email:</b> ${e(contact.email || '—')}</div>
          ${typeChipRow}
        </div>`;
}

module.exports = {
    resolveClientContact,
    resolveQuotationCustomerContact,
    renderDocumentCustomerCardHtml,
};
