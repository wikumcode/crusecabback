const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expense.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

router.use(authenticateToken);

router.get('/', expenseController.getAllExpenses);
router.get('/:id', expenseController.getExpenseById);
router.post('/', authorizeRoles('ADMIN', 'STAFF'), expenseController.createExpense);
router.put('/:id', authorizeRoles('ADMIN', 'STAFF'), expenseController.updateExpense);
router.delete('/:id', authorizeRoles('ADMIN', 'STAFF'), expenseController.deleteExpense);

module.exports = router;
