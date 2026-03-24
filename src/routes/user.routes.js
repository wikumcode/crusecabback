const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Protect all routes: Only ADMIN (and implicitly SUPER_ADMIN)
router.get('/', authenticateToken, authorizeRoles('ADMIN'), userController.getUsers);
router.post('/', authenticateToken, authorizeRoles('ADMIN'), userController.createUser);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), userController.deleteUser);

module.exports = router;
