const prisma = require('../lib/prisma');
const { z } = require('zod');
const { templates: defaultTemplates } = require('../services/email/templates');

const upsertTemplateSchema = z.object({
  subject: z.string().min(1),
  html: z.string().min(1),
});

const allowedKeys = Object.keys(defaultTemplates).map(k => String(k || '').toUpperCase());

exports.listTemplates = async (req, res) => {
  try {
    const dbTemplates = await prisma.emailTemplate.findMany();
    const byKey = new Map(dbTemplates.map(t => [String(t.templateKey).toUpperCase(), t]));

    // Return all known template keys (including defaults), merged with DB overrides.
    const merged = allowedKeys.map((key) => {
      const row = byKey.get(key);
      const fallback = defaultTemplates[key];
      return {
        templateKey: key,
        subjectTemplate: row?.subjectTemplate ?? fallback?.subject ?? '',
        htmlTemplate: row?.htmlTemplate ?? fallback?.html ?? '',
      };
    });

    // Also include any DB templates that are not in defaults.
    const extra = dbTemplates
      .map(t => String(t.templateKey).toUpperCase())
      .filter(k => !allowedKeys.includes(k))
      .map(k => {
        const row = byKey.get(k);
        return {
          templateKey: k,
          subjectTemplate: row?.subjectTemplate ?? '',
          htmlTemplate: row?.htmlTemplate ?? '',
        };
      });

    res.json({ templates: [...merged, ...extra] });
  } catch (error) {
    console.error('List Email Templates Error:', error);
    res.status(500).json({ message: 'Failed to list email templates' });
  }
};

exports.upsertTemplate = async (req, res) => {
  try {
    const templateKey = String(req.params.templateKey || '').toUpperCase();
    if (!templateKey) return res.status(400).json({ message: 'templateKey is required' });

    const data = upsertTemplateSchema.parse(req.body || {});

    const updated = await prisma.emailTemplate.upsert({
      where: { templateKey },
      update: {
        subjectTemplate: data.subject,
        htmlTemplate: data.html,
      },
      create: {
        templateKey,
        subjectTemplate: data.subject,
        htmlTemplate: data.html,
      }
    });

    res.json({ template: updated });
  } catch (error) {
    console.error('Upsert Email Template Error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation Error', errors: error.errors });
    }
    res.status(400).json({ message: error.message || 'Failed to upsert template' });
  }
};

