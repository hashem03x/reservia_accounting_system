const express = require('express');
const { check } = require('express-validator');
const authController = require('../controller/user/authController');
const validatorMiddleware = require('../middleware/validatorMiddleware');
const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');
const { getExpenseCategories, createExpenseCategory, updateExpenseCategory, deleteExpenseCategory } = require('../controller/expenseCategoryController');

const router = express.Router();

// Anyone who can read expenses can list the categories (the expense form and filters need them);
// creating, editing, (de)activating and deleting them is for administrators.
router.use(authController.protect);

const categoryValidators = creating => [
  ...(creating ? [check('name').notEmpty().withMessage('Category name is required')] : [check('id').isMongoId().withMessage('Invalid expense category id')]),
  check('name').optional().isString().trim().notEmpty().withMessage('Category name cannot be empty').isLength({ max: 100 }),
  check('nameAr').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  check('isActive').optional().isBoolean().withMessage('isActive must be true or false'),
  validatorMiddleware,
];

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), getExpenseCategories)
  .post(authController.allowedTo('admin'), categoryValidators(true), createExpenseCategory);

router
  .route('/:id')
  .patch(authController.allowedTo('admin'), categoryValidators(false), updateExpenseCategory)
  .delete(authController.allowedTo('admin'), check('id').isMongoId().withMessage('Invalid expense category id'), validatorMiddleware, deleteExpenseCategory);

module.exports = router;
