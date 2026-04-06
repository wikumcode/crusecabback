const express = require('express');
const router = express.Router();
const fleetController = require('../controllers/fleet.controller');

router.get('/brands', fleetController.getBrands);
router.post('/brands', fleetController.createBrand);
router.put('/brands/:id', fleetController.updateBrand);
router.delete('/brands/:id', fleetController.deleteBrand);

router.get('/models', fleetController.getModels);
router.post('/models', fleetController.createModel);
router.put('/models/:id', fleetController.updateModel);
router.delete('/models/:id', fleetController.deleteModel);

// Categories
router.get('/categories', fleetController.getCategories);
router.post('/categories', fleetController.createCategory);
router.put('/categories/:id', fleetController.updateCategory);
router.delete('/categories/:id', fleetController.deleteCategory);

module.exports = router;
