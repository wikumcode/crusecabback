const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotation.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), quotationController.listQuotations);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), quotationController.getQuotation);
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), quotationController.createQuotation);

module.exports = router;

