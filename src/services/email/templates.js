function renderTemplateString(template, variables = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = variables[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

const wrap = (body) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color:#0f172a;">
    ${body}
    <br />
    <p style="color:#64748b;font-size:13px;">Best regards,<br /><b>{company_name}</b></p>
  </div>`;

const templates = {
  WELCOME: {
    subject: 'Welcome to {company_name}',
    html: wrap(`
      <h2>Welcome, {customer_name}!</h2>
      <p>Thank you for registering with <b>{company_name}</b>.</p>
      <p>Your customer profile has been created successfully. We look forward to serving you.</p>
      <p><b>Customer code:</b> {customer_code}</p>
    `),
  },

  VENDOR_WELCOME: {
    subject: 'Vendor account created — {company_name}',
    html: wrap(`
      <h2>Welcome, {vendor_name}!</h2>
      <p>Your vendor account with <b>{company_name}</b> has been created.</p>
      <p><b>Vendor code:</b> {vendor_code}</p>
      <p><b>Login email:</b> {vendor_email}</p>
      {password_block}
      <p>Please sign in to the vendor portal and keep your login details secure.</p>
    `),
  },

  CONTRACT_CREATED: {
    subject: 'Rental contract {contract_no} — {company_name}',
    html: wrap(`
      <h2>Your rental contract is confirmed</h2>
      <p>Hello {customer_name},</p>
      <p>We have created your rental contract with the details below.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;">Contract no</td><td style="padding:6px 0;"><b>{contract_no}</b></td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Vehicle</td><td style="padding:6px 0;">{vehicle_label}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Pick-up</td><td style="padding:6px 0;">{pickup_datetime}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Drop-off</td><td style="padding:6px 0;">{dropoff_datetime}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Daily rate</td><td style="padding:6px 0;">LKR {daily_rate}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Advance payment</td><td style="padding:6px 0;">LKR {advance_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Allocated km</td><td style="padding:6px 0;">{allocated_km} km</td></tr>
      </table>
      <p>If you have any questions, reply to this email or contact us.</p>
    `),
  },

  ADVANCE_RECEIPT_SENT: {
    subject: 'Advance receipt {receipt_no} — {contract_no}',
    html: wrap(`
      <h2>Advance payment received</h2>
      <p>Hello {customer_name},</p>
      <p>Thank you. We have recorded your advance payment.</p>
      <p><b>Receipt no:</b> {receipt_no}<br/>
      <b>Contract no:</b> {contract_no}<br/>
      <b>Amount:</b> LKR {receipt_amount}</p>
      {receipt_link_block}
    `),
  },

  INVOICE_SENT: {
    subject: '{invoice_type} invoice {invoice_no} — {contract_no}',
    html: wrap(`
      <h2>{invoice_type} invoice issued</h2>
      <p>Hello {customer_name},</p>
      <p>Please find your <b>{invoice_type}</b> invoice details below.</p>
      <p><b>Invoice no:</b> {invoice_no}<br/>
      <b>Contract no:</b> {contract_no}<br/>
      <b>Total amount:</b> LKR {invoice_total}</p>
      {invoice_link_block}
    `),
  },

  CREDIT_NOTE_ISSUED: {
    subject: 'Credit note {credit_note_no} — {reference_no}',
    html: wrap(`
      <h2>Credit note issued</h2>
      <p>Hello {customer_name},</p>
      <p>A credit note has been issued on your account.</p>
      <p><b>Credit note no:</b> {credit_note_no}<br/>
      <b>Related document:</b> {reference_no}<br/>
      <b>Amount:</b> LKR {credit_amount}</p>
      {reason_block}
    `),
  },

  CONTRACT_THANK_YOU: {
    subject: 'Thank you — contract {contract_no} completed',
    html: wrap(`
      <h2>Thank you for renting with us!</h2>
      <p>Hello {customer_name},</p>
      <p>Your rental contract <b>{contract_no}</b> has been completed.</p>
      <p>We appreciate your business and hope you enjoyed your experience with <b>{company_name}</b>.</p>
      <p>We look forward to serving you again soon.</p>
    `),
  },

  BOOKING_CONFIRMATION: {
    subject: 'Booking confirmation — {booking_reference}',
    html: wrap(`
      <h2>Booking confirmed</h2>
      <p>Booking ref: <b>{booking_reference}</b></p>
      <p>Date/Time: {booking_datetime}</p>
      <p>Customer: {customer_name}</p>
    `),
  },
};

function getTemplate(templateKey) {
  const key = String(templateKey || '').toUpperCase();
  return templates[key] || null;
}

function renderTemplate(templateKey, variables) {
  const tpl = getTemplate(templateKey);
  if (!tpl) throw new Error(`Email template not found: ${templateKey}`);
  return {
    subject: renderTemplateString(tpl.subject, variables),
    html: renderTemplateString(tpl.html, variables),
  };
}

module.exports = {
  renderTemplateString,
  templates,
  getTemplate,
  renderTemplate,
};
