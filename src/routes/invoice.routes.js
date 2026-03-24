const express = require('express');
const router = express.Router();

const invoiceController = require('../controllers/invoice.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Admin/Staff only
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), invoiceController.listInvoices);
router.get('/contract/:contractId', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), invoiceController.getInvoiceByContract);
router.post('/contract/:contractId/upfront', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), invoiceController.createUpfrontInvoiceForContract);
router.post('/contract/:contractId/return', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), invoiceController.createReturnInvoiceForContract);
// Customer share view (token-based) - used in outgoing invoice emails
router.get('/share/:invoiceId', invoiceController.getSharedInvoice);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), invoiceController.getInvoice);
router.put('/:id/mark-paid', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), invoiceController.markInvoicePaid);
router.post('/:id/credit-note', authenticateToken, authorizeRoles('ADMIN'), invoiceController.createCreditNote);

module.exports = router;

