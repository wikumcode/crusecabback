const express = require('express');
const router = express.Router();
const emailTemplatesController = require('../controllers/emailTemplates.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Admin only (templates contain editable HTML)
router.get(
  '/',
  authenticateToken,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  emailTemplatesController.listTemplates
);

router.put(
  '/:templateKey',
  authenticateToken,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  emailTemplatesController.upsertTemplate
);

module.exports = router;

