const express = require('express');
const router = express.Router();
const systemController = require('../controllers/system.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.get('/dashboard-stats', authenticateToken, authorizeRoles('ADMIN', 'STAFF', 'SUPER_ADMIN'), systemController.getDashboardStats);
router.post('/load-demo-data', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.loadDemoData);
router.post('/remove-demo-data', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.removeDemoData);
router.delete('/wipe-all-data', authenticateToken, authorizeRoles('SUPER_ADMIN'), systemController.wipeAllData);

module.exports = router;
