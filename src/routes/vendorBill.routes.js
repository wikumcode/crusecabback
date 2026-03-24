const express = require('express');
const router = express.Router();
const vendorBillController = require('../controllers/vendorBill.controller');

router.get('/', vendorBillController.getVendorBills);
router.post('/', vendorBillController.createVendorBill);
router.put('/:id', vendorBillController.updateVendorBill);
router.post('/generate', vendorBillController.generateBills);
router.put('/:id/status', vendorBillController.updateBillStatus);

module.exports = router;
