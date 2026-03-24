const express = require('express');
const router = express.Router();
const permissionGroupController = require('../controllers/permissionGroup.controller');

router.get('/', permissionGroupController.getPermissionGroups);
router.post('/', permissionGroupController.createPermissionGroup);
router.put('/:id', permissionGroupController.updatePermissionGroup);
router.delete('/:id', permissionGroupController.deletePermissionGroup);

module.exports = router;
