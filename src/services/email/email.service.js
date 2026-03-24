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

async function testSmtpConnection() {
  const settings = await getEmailSettingsOrThrow();
  const transporter = buildTransportFromSettings(settings);
  try {
    const result = await transporter.verify();
    return { ok: true, message: result && result.message ? result.message : 'SMTP connection verified.' };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
}

module.exports = {
  sendEmail,
  sendTemplateEmail,
  testSmtpConnection,
};

