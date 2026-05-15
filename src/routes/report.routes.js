const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.get(
    '/vehicle-pl',
    authenticateToken,
    authorizeRoles('ADMIN', 'STAFF'),
    reportController.getVehiclePL
);
router.get(
    '/customer-aging',
    authenticateToken,
    authorizeRoles('ADMIN', 'STAFF'),
    reportController.getCustomerAging
);
router.get(
    '/overdue-contracts',
    authenticateToken,
    authorizeRoles('ADMIN', 'STAFF'),
    reportController.getOverdueContracts
);
router.get(
    '/contract-expiry',
    authenticateToken,
    authorizeRoles('ADMIN', 'STAFF'),
    reportController.getContractExpiryDetails
);

module.exports = router;
