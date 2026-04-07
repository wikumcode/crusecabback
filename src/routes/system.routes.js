const express = require('express');
const router = express.Router();
const systemController = require('../controllers/system.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.post('/load-demo-data', authenticateToken, authorizeRoles('SUPER_ADMIN'), systemController.loadDemoData);
router.delete('/remove-demo-data', authenticateToken, authorizeRoles('SUPER_ADMIN', 'ADMIN'), systemController.removeDemoData);
router.delete('/wipe-all-data', authenticateToken, authorizeRoles('SUPER_ADMIN'), systemController.wipeAllData);
router.get('/sequences', authenticateToken, authorizeRoles('SUPER_ADMIN'), systemController.getSequences);
router.put('/sequences', authenticateToken, authorizeRoles('SUPER_ADMIN'), systemController.updateSequence);

module.exports = router;
