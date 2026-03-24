const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driver.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Protected routes (Admin/Staff only)
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), driverController.createDriver);
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), driverController.getDrivers);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), driverController.getDriver);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), driverController.updateDriver);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), driverController.deleteDriver);

module.exports = router;
