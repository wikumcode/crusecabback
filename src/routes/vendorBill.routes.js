const express = require('express');
const router = express.Router();
const vendorBillController = require('../controllers/vendorBill.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Public (token-protected)
router.get('/share/:billId', vendorBillController.getSharedVendorBill);

// Admin/Staff only
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorBillController.getVendorBills);
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorBillController.createVendorBill);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorBillController.updateVendorBill);
router.post('/generate', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorBillController.generateBills);
router.put('/:id/status', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorBillController.updateBillStatus);
router.get('/:id/share-link', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), vendorBillController.getVendorBillShareLink);

module.exports = router;
