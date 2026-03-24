const express = require('express');
const router = express.Router();
const clientController = require('../controllers/client.controller');

// Add Multer middleware here later for files
router.post('/', clientController.createClient);
router.get('/', clientController.getAllClients);
router.put('/:id', clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

// Duplicate Checks
router.get('/check-nic', clientController.checkNic);
router.get('/check-passport', clientController.checkPassport);
router.get('/check-br', clientController.checkBr);
router.get('/check-email', clientController.checkEmail);

module.exports = router;
