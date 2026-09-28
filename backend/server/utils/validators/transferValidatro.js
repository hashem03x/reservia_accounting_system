const { body, check } = require('express-validator');
const Warehouse = require('../../models/inventory/warehouseModel');
const Variant = require('../../models/inventory/variantModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { PaymentMethods } = require('../appConstant');

exports.validateTransferStock = [
  body('type')
    .isIn(['product', 'variant', 'variants'])
    .withMessage('Invalid transfer type. Must be "product", "variant", or "variants".')
    .custom((value, { req }) => {
      if (value === 'variants' && !Array.isArray(req.body.details) && !req.body.productId) {
        throw new Error('Details must be an array for multiple variants transfer && productId is required');
      }
      return true;
    }),

  body('warehouseId')
    .isMongoId()
    .withMessage('Invalid source warehouse ID')
    .custom(async (value, { req }) => {
      const warehouse = await Warehouse.findById(value);
      if (!warehouse) {
        throw new Error('Warehouse does not exist');
      }
      return true;
    }),

  body('targetWarehouseId')
    .isMongoId()
    .withMessage('Invalid target warehouse ID')
    .custom(async (value, { req }) => {
      const warehouse = await Warehouse.findById(value);
      if (!warehouse) {
        throw new Error('Target warehouse does not exist');
      }
      return true;
    }),

  body('details').custom(async (value, { req }) => {
    const { type } = req.body;

    if (!value) {
      throw new Error('Details field is required');
    }

    if (type === 'product') {
      if (!value.productId) {
        throw new Error('Product ID is required for product transfer');
      }
    } else if (type === 'variant') {
      if (!value.variantId || typeof value.quantity !== 'number' || value.quantity <= 0) {
        throw new Error('Variant ID and a valid quantity are required for single variant transfer');
      }
    } else if (type === 'variants') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Details must be a non-empty array for multiple variants transfer');
      }

      for (const item of value) {
        const variant = await Variant.findById(item.variantId);
        if (!variant) {
          throw new Error(`Variant with ID ${item.variantId} not found`);
        }
        if (!item.variantId || typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error('Each detail in variants must include a valid variantId and quantity > 0');
        }
      }
    }
    return true;
  }),
  body('transferedBy')
    .optional()
    .custom(async (value, { req }) => {
      if (!req.user) {
        req.body.transferedBy = req.user._id;
      }
      return true;
    }),

  validatorMiddleware,
];

exports.validateMoneyTransfer = [
  check('from_warehouse_id').notEmpty().withMessage('Source warehouse ID is required').isMongoId().withMessage('Invalid source warehouse ID format'),
  check('to_warehouse_id').notEmpty().withMessage('Target warehouse ID is required').isMongoId().withMessage('Invalid target warehouse ID format'),

  check('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isNumeric()
    .withMessage('Amount must be a number')
    .custom(value => {
      if (value <= 0) throw new Error('Amount must be greater than 0');
      return true;
    }),

  check('withdraw_method')
    .optional()
    .isIn(PaymentMethods)
    .withMessage(`Withdraw method must be one of: ${PaymentMethods.join(', ')}`),

  check('deposit_method')
    .optional()
    .isIn(PaymentMethods)
    .withMessage(`Deposit method must be one of: ${PaymentMethods.join(', ')}`),

  validatorMiddleware,
];
