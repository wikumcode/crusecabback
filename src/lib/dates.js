/**
 * Centralised date-display helpers.
 *
 * The whole UI uses **day-first** ordering (dd/MM/yyyy or "09 May 2026"),
 * regardless of the user's browser locale, so dates never flip to US-style
 * MM/DD/YYYY just because Chrome is set to en-US.
 *
 * Use these helpers for any date that is rendered to the user (table cells,
 * modals, PDFs, share pages). Do NOT use them for ISO strings sent to the API
 * or used as `<input type="date">` values — those must stay as `yyyy-MM-dd`.
 */

const { format: fnsFormat, isValid } = require('date-fns');

/** Coerces ISO strings, Date objects, timestamps, etc. to a real Date or null. */
function coerce(value) {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return isValid(d) ? d : null;
}

/**
 * Numeric day-first date: `09/05/2026`.
 */
function formatDate(value, fallback = '—') {
    const d = coerce(value);
    return d ? fnsFormat(d, 'dd/MM/yyyy') : fallback;
}

/**
 * Numeric day-first date + 24h time: `09/05/2026 16:35`.
 */
function formatDateTime(value, fallback = '—') {
    const d = coerce(value);
    return d ? fnsFormat(d, 'dd/MM/yyyy HH:mm') : fallback;
}

/**
 * Friendly day-first date with spelled-out month: `09 May 2026`.
 */
function formatDateLong(value, fallback = '—') {
    const d = coerce(value);
    return d ? fnsFormat(d, 'dd MMM yyyy') : fallback;
}

/**
 * Friendly day-first date + 24h time: `09 May 2026 16:35`.
 */
function formatDateTimeLong(value, fallback = '—') {
    const d = coerce(value);
    return d ? fnsFormat(d, 'dd MMM yyyy HH:mm') : fallback;
}

/**
 * Renders a date range like `01/05/2026 → 09/05/2026`
 */
function formatDateRange(from, to, { long = false, separator = ' → ' } = {}) {
    const fmt = long ? formatDateLong : formatDate;
    const f = fmt(from, '');
    const t = fmt(to, '');
    if (!f && !t) return '—';
    if (!t) return f;
    if (!f) return t;
    return `${f}${separator}${t}`;
}

module.exports = {
    formatDate,
    formatDateTime,
    formatDateLong,
    formatDateTimeLong,
    formatDateRange
};
