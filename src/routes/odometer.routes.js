const express = require('express');
const router = express.Router();
const odometerController = require('../controllers/odometer.controller');

router.post('/', odometerController.createOdometer);
router.get('/vehicle/:vehicleId', odometerController.getOdometersByVehicle);
router.get('/', odometerController.getAllOdometers);

module.exports = router;
