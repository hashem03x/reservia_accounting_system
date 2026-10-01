const { body } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { PaymentMethods } = require('../appConstant');

const createReturnValidate = [
  body('salesOrderId').notEmpty().withMessage('Sales Order ID is required').isMongoId().withMessage('Sales Order ID must be a mongoID'),

  body('warehouseId').isMongoId().withMessage('Warehouse ID must be a mongoID').notEmpty().withMessage('Warehouse ID is required'),

  body('productId').notEmpty().withMessage('Product ID is required').isMongoId().withMessage('Product ID must be a mongoID'),

  body('returnedQuantity').notEmpty().withMessage('Returned quantity is required').isInt({ gt: 0 }).withMessage('Returned quantity must be a positive integer'),

  body('paymentMethod').notEmpty().withMessage('Payment method is required').isIn(PaymentMethods).withMessage('Invalid payment method'),

  body('notes').optional().isString().withMessage('Notes must be a string'),

  validatorMiddleware,
];

const returnAllItemsValidate = [
  body('salesOrderId').notEmpty().withMessage('Sales Order ID is required').isMongoId().withMessage('Sales Order ID must be a mongoID'),

  body('warehouseId').isMongoId().withMessage('Warehouse ID must be a mongoID').notEmpty().withMessage('Warehouse ID is required'),

  body('paymentMethod').notEmpty().withMessage('Payment method is required').isIn(PaymentMethods).withMessage('Invalid payment method'),

  body('notes').optional().isString().withMessage('Notes must be a string'),

  validatorMiddleware,
];

module.exports = { createReturnValidate, returnAllItemsValidate };
