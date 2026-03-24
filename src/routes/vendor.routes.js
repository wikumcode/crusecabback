const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Protect routes: ADMIN/STAFF can manage vendors
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorController.getVendors);
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorController.createVendor);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorController.updateVendor);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorController.deleteVendor);

module.exports = router;
