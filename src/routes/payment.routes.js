const express = require('express');
const router = express.Router();
const { getAllPayments, createPayment, deletePayment, getVehiclesForPayment } = require('../controllers/payment.controller.js');

router.get('/', getAllPayments);
router.post('/', createPayment);
router.delete('/:id', deletePayment);
router.get('/vehicles', getVehiclesForPayment);

module.exports = router;
