const nodemailer = require('nodemailer');
const prisma = require('../../lib/prisma');
const { renderTemplateString, templates: defaultTemplates } = require('./templates');

function normalizeEncryption(encryption) {
  const e = String(encryption || '').toUpperCase();
  if (!e) return 'TLS';
  if (e.includes('SSL') || e === 'SMTPS') return 'SSL';
  if (e.includes('TLS') || e.includes('STARTTLS')) return 'TLS';
  if (e === 'NONE' || e === 'OFF') return 'NONE';
  return e;
}

function buildTransportFromSettings(settings) {
  const encryption = normalizeEncryption(settings.encryption);
  const secure = encryption === 'SSL';
  const requireTLS = encryption === 'TLS';

  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure,
    auth: {
      user: settings.username,
      pass: settings.password
    },
    ...(requireTLS ? { requireTLS: true } : {})
  });
}

async function getEmailSettingsOrThrow() {
  const settings = await prisma.emailSettings.findFirst();
  if (!settings) {
    throw new Error('Email SMTP settings are not configured (email_settings table is empty).');
  }
  return settings;
}

async function logEmail({ toEmail, subject, status, errorMessage }) {
  await prisma.emailLog.create({
    data: {
      toEmail,
      subject,
      status,
      errorMessage: errorMessage ? String(errorMessage) : null
    }
  });
}

async function sendEmail(to, subject, htmlContent) {
  const toEmail = String(to || '').trim();
  if (!toEmail) throw new Error('Recipient email is required.');

  let settings;
  try {
    settings = await getEmailSettingsOrThrow();
    const transporter = buildTransportFromSettings(settings);

    const fromEmail = settings?.fromEmail || settings?.username;
    const fromName = settings?.fromName || 'Cruiser Cabs';

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: toEmail,
      subject: String(subject || ''),
      html: String(htmlContent || '')
    });

    await logEmail({ toEmail, subject, status: 'success' });
    return info;
  } catch (err) {
    try {
      await logEmail({
        toEmail,
        subject,
        status: 'failed',
        errorMessage: err?.message || String(err)
      });
    } catch (logErr) {
      // If logging fails, don't mask the original error.
      console.error('Email logging failed:', logErr?.message || logErr);
    }
    throw err;
  }
}

async function sendTemplateEmail(templateKey, to, variables = {}) {
  const key = String(templateKey || '').toUpperCase();
  if (!key) throw new Error('Template key is required');

  const row = await prisma.emailTemplate.findUnique({ where: { templateKey: key } }).catch(() => null);
  const tpl = row
    ? { subject: row.subjectTemplate, html: row.htmlTemplate }
    : defaultTemplates[key];

  if (!tpl) throw new Error(`Email template not found: ${key}`);

  const subject = renderTemplateString(tpl.subject, variables);
  const html = renderTemplateString(tpl.html, variables);
  return sendEmail(to, subject, html);
}

async function testSmtpConnection(providedSettings) {
  let settings;
  
  if (providedSettings && (providedSettings.smtp_host || providedSettings.smtpHost)) {
    const existing = await prisma.emailSettings.findFirst();
    settings = {
      smtpHost: providedSettings.smtp_host || providedSettings.smtpHost,
      smtpPort: providedSettings.smtp_port || providedSettings.smtpPort,
      username: providedSettings.username,
      password: providedSettings.password || existing?.password,
      encryption: providedSettings.encryption
    };

    if (!settings.password) {
      return { ok: false, message: 'SMTP password is required for testing.' };
    }
  } else {
    settings = await getEmailSettingsOrThrow();
  }

  const transporter = buildTransportFromSettings(settings);
  try {
    console.log(`[SMTP Test] Attempting connection to ${settings.smtpHost}:${settings.smtpPort} as ${settings.username}...`);
    await transporter.verify();
    return { ok: true, message: 'SMTP connection verified successfully.' };
  } catch (err) {
    console.error('[SMTP Test] Connection failed:', err);
    let msg = err?.message || String(err);
    
    // Add a helpful checklist to the error message
    const checklist = "\n\nDIAGNOSTIC CHECKLIST:\n1. Username must be your FULL email address.\n2. You must use a 16-character GOOGLE APP PASSWORD (not your regular password).\n3. Port 465 requires SSL encryption. Port 587 requires TLS/STARTTLS.";
    
    if (msg.includes('Invalid login') || msg.includes('authentication failed')) {
      msg = `Authentication Failed: ${msg}${checklist}`;
    } else if (msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
      msg = `Connection Timeout/Refused: ${msg}${checklist}`;
    } else {
      msg = `SMTP Error: ${msg}${checklist}`;
    }
    
    return { ok: false, message: msg };
  }
}

module.exports = {
  sendEmail,
  sendTemplateEmail,
  testSmtpConnection,
};

