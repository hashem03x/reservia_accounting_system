const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

const { PaymentMethods } = require('../appConstant');

exports.createPurchasePaymentValidator = [
    check('warehouseId')
        .notEmpty()
        .withMessage('Warehouse ID is required')
        .isMongoId()
        .withMessage('Invalid warehouse ID'),

    check('purchaseOrderId')
        .notEmpty()
        .withMessage('Purchase order ID is required')
        .isMongoId()
        .withMessage('Invalid purchase order ID'),

    check('amountPaid')
        .notEmpty()
        .withMessage('Payment amount is required')
        .isNumeric()
        .withMessage('Amount must be a number')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),

    check('paymentMethod')
        .notEmpty()
        .withMessage('Payment method is required')
        .isIn(PaymentMethods)
        .withMessage('Invalid payment method'),

    check('notes')
        .optional()
        .isString()
        .withMessage('Notes must be a string'),

    validatorMiddleware,
];

exports.createSalesPaymentValidator = [
    check('warehouseId')
        .notEmpty()
        .withMessage('Warehouse ID is required')
        .isMongoId()
        .withMessage('Invalid warehouse ID'),

    check('salesOrderId')
        .notEmpty()
        .withMessage('Sales order ID is required')
        .isMongoId()
        .withMessage('Invalid purchase order ID'),

    check('amountPaid')
        .notEmpty()
        .withMessage('Payment amount is required')
        .isNumeric()
        .withMessage('Amount must be a number')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),

    check('paymentMethod')
        .notEmpty()
        .withMessage('Payment method is required')
        .isIn(PaymentMethods)
        .withMessage('Invalid payment method'),

    check('notes')
        .optional()
        .isString()
        .withMessage('Notes must be a string'),

    validatorMiddleware,
];
