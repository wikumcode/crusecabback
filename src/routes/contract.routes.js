const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contractController');

router.post('/', contractController.createContract);
router.get('/', contractController.getContracts);
router.put('/:id', contractController.updateContract);
router.post('/:id/exchange', contractController.exchangeVehicle);
router.put('/exchange/:exchangeId', contractController.updateExchangeChecklist);
router.delete('/:id', contractController.deleteContract);

module.exports = router;
