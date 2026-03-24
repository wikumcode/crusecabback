const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');

router.get('/vehicle-pl', reportController.getVehiclePL);

module.exports = router;
