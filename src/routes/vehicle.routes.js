const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicle.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Public routes (e.g. for landing page listing in future)
router.get('/', vehicleController.getVehicles);
router.get('/:id', vehicleController.getVehicle);

// Protected routes (Admin/Staff only)
// Protected routes (Admin/Staff only)
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vehicleController.createVehicle);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vehicleController.updateVehicle);
// Deletion is restricted to ADMIN and SUPER_ADMIN only (SUPER_ADMIN is allowed by middleware).
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), vehicleController.deleteVehicle);

module.exports = router;
