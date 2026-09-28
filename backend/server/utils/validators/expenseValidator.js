const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { expensesCategories, PaymentMethods } = require('../appConstant');

exports.createExpenseValidator = [
    check('expenseCategory')
        .notEmpty().withMessage('Expense category is required')
        .isIn(expensesCategories)
        .withMessage('Invalid expense category'),

    check('description')
        .optional()
        .isString().withMessage('Description must be a string')
        .isLength({ max: 200 }).withMessage('Description cannot exceed 200 characters'),

    check('warehouseId')
        .notEmpty().withMessage('Warehouse ID is required')
        .isMongoId().withMessage('Invalid warehouse ID'),

    check('amountPaid')
        .notEmpty().withMessage('Amount is required')
        .isNumeric().withMessage('Amount must be a number')
        .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),

    check('paymentMethod')
        .notEmpty().withMessage('Payment method is required')
        .isIn(PaymentMethods)
        .withMessage('Invalid payment method'),

    validatorMiddleware
];
