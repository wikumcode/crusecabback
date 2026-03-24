const express = require('express');
const router = express.Router();
const paymentScheduleController = require('../controllers/paymentSchedule.controller');

router.get('/', paymentScheduleController.getPaymentSchedules);
router.post('/', paymentScheduleController.createPaymentSchedule);
router.put('/:id', paymentScheduleController.updatePaymentSchedule);
router.delete('/:id', paymentScheduleController.deletePaymentSchedule);

module.exports = router;
