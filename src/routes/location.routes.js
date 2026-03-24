const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');

// Districts
router.get('/districts', locationController.getDistricts);
router.post('/districts', locationController.createDistrict);

// Cities
router.get('/cities', locationController.getCities);
router.post('/cities', locationController.createCity);

module.exports = router;
