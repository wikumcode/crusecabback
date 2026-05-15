const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotation.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Public customer view (token) — must be registered before "/:id"
router.get('/share/:quotationId', quotationController.getSharedQuotation);

router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), quotationController.listQuotations);
router.get('/:id/share-link', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), quotationController.getQuotationShareLink);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), quotationController.getQuotation);
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), quotationController.createQuotation);

module.exports = router;
