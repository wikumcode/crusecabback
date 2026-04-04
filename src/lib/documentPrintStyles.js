/**
 * Shared styles for HTML invoice share view (browser print / PDF).
 * Keep in sync with cruisecabfront-main/src/lib/printDocumentTheme.js
 */
module.exports.DOCUMENT_PRINT_STYLES = `
:root {
  --accent: #FA5A28;
  --accent-soft: #FFF4EF;
  --ink: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
  background: #f1f5f9;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.doc {
  max-width: 720px;
  margin: 0 auto;
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(15,23,42,0.06);
  border: 1px solid var(--line);
}
.doc-topbar {
  height: 5px;
  background: linear-gradient(90deg, var(--accent) 0%, #ff8a5c 100%);
}
.doc-inner { padding: 28px 32px 32px; }
.doc-brand-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--line);
}
.doc-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border-radius: 14px;
  background: var(--accent-soft);
  padding: 8px;
  flex-shrink: 0;
}
.doc-company-name {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--ink);
}
.doc-company-muted {
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
  max-width: 440px;
}
.doc-chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.doc-chip {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 4px 10px;
  border-radius: 999px;
}
.doc-headline {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}
.doc-kind {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--accent);
  margin-bottom: 4px;
}
.doc-main-id {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.doc-meta {
  font-size: 12px;
  color: var(--muted);
  margin-top: 8px;
}
.doc-meta b { color: var(--ink); font-weight: 600; }
.doc-pill {
  font-size: 12px;
  font-weight: 700;
  padding: 8px 14px;
  border-radius: 999px;
  background: #f1f5f9;
  color: var(--ink);
  white-space: nowrap;
}
.doc-pill-em {
  background: var(--accent-soft);
  color: var(--accent);
}
.doc-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 22px;
}
.doc-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 16px;
  background: #fafbfc;
}
.doc-card-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
  margin-bottom: 6px;
}
.doc-card-value { font-weight: 700; font-size: 14px; }
.doc-card-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
.doc-table-wrap {
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  margin-top: 8px;
}
table.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.doc-table thead th {
  text-align: left;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  background: #f8fafc;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}
.doc-table thead th:last-child { text-align: right; }
.doc-table tbody td {
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}
.doc-table tbody tr:last-child td { border-bottom: none; }
.doc-table tbody td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.doc-table tfoot td {
  padding: 14px;
  font-weight: 800;
  font-size: 15px;
  background: var(--accent-soft);
  border-top: 2px solid var(--accent);
}
.doc-table tfoot td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.doc-foot {
  margin-top: 24px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
}
@media print {
  body { background: #fff; padding: 0; }
  .doc { box-shadow: none; border: none; border-radius: 0; max-width: none; }
  .doc-inner { padding: 20px; }
}
@media (max-width: 560px) {
  .doc-cards { grid-template-columns: 1fr; }
}
`;
