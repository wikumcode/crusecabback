const prisma = require('../lib/prisma');
const { z } = require('zod');
const { testSmtpConnection } = require('../services/email/email.service');

const emailSettingsSchema = z.object({
  smtp_host: z.string().min(1),
  smtp_port: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  username: z.string().min(1),
  // Optional: if empty, keep existing password (for security and better UX).
  password: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const s = String(v);
      return s.trim() === '' ? undefined : s;
    }),
  encryption: z.string().min(1), // TLS/SSL/NONE
  from_email: z.string().email(),
  from_name: z.string().min(1),
});

exports.getEmailSettings = async (req, res) => {
  try {
    const settings = await prisma.emailSettings.findFirst();
    if (!settings) return res.json({ settings: null });
    // Do not expose password back to client
    const { password, ...safe } = settings;
    res.json({ settings: safe });
  } catch (error) {
    console.error('Get Email Settings Error:', error);
    res.status(500).json({ message: 'Failed to fetch email settings' });
  }
};

exports.updateEmailSettings = async (req, res) => {
  try {
    const data = emailSettingsSchema.parse(req.body || {});
    const existing = await prisma.emailSettings.findFirst();

    const finalPassword = data.password ?? existing?.password;
    if (!existing && !finalPassword) {
      return res.status(400).json({ message: 'SMTP password is required for first-time setup' });
    }

    const settings = existing
      ? await prisma.emailSettings.update({
        where: { id: existing.id },
        data: {
          smtpHost: data.smtp_host,
          smtpPort: data.smtp_port,
          username: data.username,
          password: finalPassword,
          encryption: data.encryption,
          fromEmail: data.from_email,
          fromName: data.from_name,
        }
      })
      : await prisma.emailSettings.create({
        data: {
          smtpHost: data.smtp_host,
          smtpPort: data.smtp_port,
          username: data.username,
          password: finalPassword,
          encryption: data.encryption,
          fromEmail: data.from_email,
          fromName: data.from_name,
        }
      });

    const { password, ...safe } = settings;
    res.json({ settings: safe });
  } catch (error) {
    console.error('Update Email Settings Error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation Error', errors: error.errors });
    }
    res.status(400).json({ message: error.message || 'Failed to update email settings' });
  }
};

exports.testConnection = async (req, res) => {
  try {
    const result = await testSmtpConnection();
    if (result.ok) return res.json({ ok: true, message: result.message });
    return res.status(400).json({ ok: false, message: result.message });
  } catch (error) {
    console.error('Test SMTP connection error:', error);
    return res.status(500).json({ ok: false, message: error?.message || 'Failed to test SMTP connection' });
  }
};

