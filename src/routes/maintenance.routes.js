const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.use(authenticateToken);

router.get('/', maintenanceController.getAllMaintenances);
router.get('/:id', maintenanceController.getMaintenanceById);
router.post('/', authorizeRoles('ADMIN', 'STAFF'), maintenanceController.createMaintenance);
router.put('/:id', authorizeRoles('ADMIN', 'STAFF'), maintenanceController.updateMaintenance);
router.delete('/:id', authorizeRoles('ADMIN', 'STAFF'), maintenanceController.deleteMaintenance);

module.exports = router;
