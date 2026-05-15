const express = require('express');
const router = express.Router();

const agreementController = require('../controllers/agreement.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), agreementController.listAgreements);
router.get('/contract/:contractId', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), agreementController.getAgreementByContract);
router.post('/contract/:contractId/generate', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), agreementController.createAgreementForContract);
router.get('/share/:agreementId', agreementController.getSharedAgreement);
router.get('/:id/share-link', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), agreementController.getAgreementShareLink);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), agreementController.getAgreement);

module.exports = router;

