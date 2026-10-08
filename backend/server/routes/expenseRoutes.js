const express = require('express');

const expenseController = require('../controller/expenseController');
const authController = require('../controller/user/authController');
const { createExpenseValidator, addExpensePaymentValidator, updateExpenseValidator } = require('../utils/validators/expenseValidator');

const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect);

// Registered before '/:id' so it is never matched as an id.
router.get('/account-options', checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), expenseController.getExpenseAccountOptions);

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), expenseController.getExpenses)
  .post(checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), createExpenseValidator, expenseController.createExpense);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), expenseController.getExpenseById)
  .patch(checkUserPermissions({ resource: Resources.expenses, action: Actions.update }), updateExpenseValidator, expenseController.updateExpense);

router.post('/:id/payments', checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), addExpensePaymentValidator, expenseController.addExpensePayment);

module.exports = router;
