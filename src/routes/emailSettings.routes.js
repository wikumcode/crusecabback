const express = require('express');
const router = express.Router();
const emailSettingsController = require('../controllers/emailSettings.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.get(
  '/',
  authenticateToken,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  emailSettingsController.getEmailSettings
);

router.put(
  '/',
  authenticateToken,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  emailSettingsController.updateEmailSettings
);

router.post(
  '/test',
  authenticateToken,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  emailSettingsController.testConnection
);

module.exports = router;

