function renderTemplateString(template, variables = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = variables[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

const templates = {
  // Customer registration welcome email
  WELCOME: {
    subject: 'Welcome to Cruiser Cabs',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Cruiser Cabs, {customer_name}!</h2>
        <p>Thank you for registering with Cruiser Cabs.</p>
        <p>We look forward to serving you and providing you with an ultimate travel experience.</p>
        <br />
        <p>Best regards,<br />The Cruiser Cabs Team</p>
      </div>
    `
  },

  // Future: booking confirmation email
  BOOKING_CONFIRMATION: {
    subject: 'Booking Confirmation - {booking_reference}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Booking confirmed!</h2>
        <p>Booking Ref: <b>{booking_reference}</b></p>
        <p>Date/Time: {booking_datetime}</p>
        <p>Customer: {customer_name}</p>
      </div>
    `
  },

  // Future: invoice email
  INVOICE_SENT: {
    subject: 'Invoice {invoice_no} - {contract_no}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Invoice issued</h2>
        <p>Invoice No: <b>{invoice_no}</b></p>
        <p>Contract No: <b>{contract_no}</b></p>
        <p>Total Amount: {invoice_total}</p>
        <p style="margin-top:16px;">
          <a href="{invoice_link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700;">
            View Invoice
          </a>
        </p>
        <p style="font-size:12px;color:#666;margin-top:16px;">
          If the button does not work, copy this link into your browser:<br/>
          <span style="word-break:break-all;">{invoice_link}</span>
        </p>
      </div>
    `
  }
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
    html: renderTemplateString(tpl.html, variables)
  };
}

module.exports = {
  renderTemplateString,
  templates,
  getTemplate,
  renderTemplate
};

