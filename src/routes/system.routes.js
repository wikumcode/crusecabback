const express = require('express');
const router = express.Router();
const systemController = require('../controllers/system.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.get('/dashboard-stats', authenticateToken, authorizeRoles('ADMIN', 'STAFF', 'SUPER_ADMIN'), systemController.getDashboardStats);
router.post('/load-demo-data', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.loadDemoData);
router.post('/remove-demo-data', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.removeDemoData);
router.delete('/wipe-all-data', authenticateToken, authorizeRoles('SUPER_ADMIN'), systemController.wipeAllData);
router.post('/backup-database', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.downloadDatabaseBackup);
router.get('/sequences', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.getSequences);
router.put('/sequences', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.updateSequence);
router.post('/sequences/sync', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), systemController.syncSequence);

module.exports = router;
