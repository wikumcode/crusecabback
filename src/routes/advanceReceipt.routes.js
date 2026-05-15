const express = require('express');
const router = express.Router();
const advanceReceiptController = require('../controllers/advanceReceipt.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.get('/share/:id', advanceReceiptController.getSharedAdvanceReceipt);

router.post('/issue', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), advanceReceiptController.issueAdvanceReceipt);
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), advanceReceiptController.listAdvanceReceipts);
router.get(
    '/reversal/:reversalId/html',
    authenticateToken,
    authorizeRoles('ADMIN', 'STAFF'),
    advanceReceiptController.getReversalHtml,
);
router.get(
    '/:id/reversal-preview/html',
    authenticateToken,
    authorizeRoles('ADMIN', 'STAFF'),
    advanceReceiptController.getReversalPreviewHtml,
);
router.post(
    '/:id/reverse',
    authenticateToken,
    authorizeRoles('ADMIN', 'STAFF'),
    advanceReceiptController.reverseAdvanceReceipt,
);
router.get('/:id/share-link', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), advanceReceiptController.getShareLink);
router.get('/:id/html', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), advanceReceiptController.getAdvanceReceiptHtml);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), advanceReceiptController.getAdvanceReceipt);

module.exports = router;
