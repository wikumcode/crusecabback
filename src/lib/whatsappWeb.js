/**
 * Opens WhatsApp Web / app with a pre-filled message (wa.me). No server-side WhatsApp API.
 */

/** Default country code when numbers are stored as 0XXXXXXXXX (common in Sri Lanka). */
const DEFAULT_CC = '94';

/**
 * Strip non-digits; leading 0 → default country code; bare 9-digit mobile → prefix CC.
 */
function normalizePhoneForWhatsApp(input, countryCode = DEFAULT_CC) {
    const d = String(input ?? '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('0')) return countryCode + d.slice(1);
    if (d.length === 9 && /^7[0-9]{8}$/.test(d)) return countryCode + d;
    if (d.length >= 10) return d;
    return null;
}

function buildWhatsAppWebUrl(phoneDigits, message) {
    const p = String(phoneDigits ?? '').replace(/\D/g, '');
    if (!p) return null;
    const text = message ?? '';
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

function pickCustomerWhatsAppPhone(customer) {
    if (!customer) return null;
    const type = String(customer.type || '').toUpperCase();
    if (type === 'CORPORATE') {
        return (
            customer.contactPersonMobile ||
            customer.mobile ||
            customer.phone ||
            customer.closeRelationMobile ||
            null
        );
    }
    return (
        customer.mobile ||
        customer.phone ||
        customer.contactPersonMobile ||
        customer.closeRelationMobile ||
        null
    );
}

function openWhatsAppWeb(phoneDigits, message) {
    const url = buildWhatsAppWebUrl(phoneDigits, message);
    if (!url) return false;
    if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
    return true;
}

module.exports = {
    normalizePhoneForWhatsApp,
    buildWhatsAppWebUrl,
    pickCustomerWhatsAppPhone,
    openWhatsAppWeb
};
