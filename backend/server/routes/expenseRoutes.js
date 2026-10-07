const express = require('express');

const expenseController = require('../controller/expenseController');
const authController = require('../controller/user/authController');
const { createExpenseValidator, } = require('../utils/validators/expenseValidator');

const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect);

router.route('/')
  .get(
    checkUserPermissions({ resource: Resources.expenses, action: Actions.read }),
    expenseController.getExpenses
  )
  .post(
    checkUserPermissions({ resource: Resources.expenses, action: Actions.create }),
    createExpenseValidator,
    expenseController.createExpense
  );

// router.route('/:id')
//   .get(
//     checkUserPermissions({ resource: Resources.expenses, action: Actions.read }),
//     expenseController.getExpenseById
//   )

module.exports = router;
