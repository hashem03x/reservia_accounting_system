const { body, check } = require('express-validator');
const Warehouse = require('../../models/inventory/warehouseModel');
const Product = require('../../models/inventory/productModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { isPaymentAccountEligible } = require('../accountingConstants');

// Fast pre-check - services/accounting/moneyTransferService.js re-checks inside the transaction.
const eligiblePaymentAccount = async value => {
  const account = await ChartOfAccount.findById(value);
  if (!account) throw new Error('The selected account does not exist');
  if (!isPaymentAccountEligible(account)) throw new Error('The selected account must be a Cash or Cash Equivalent account');
  return true;
};

exports.validateTransferStock = [
  body('type')
    .isIn(['product', 'products'])
    .withMessage('Invalid transfer type. Must be "product" or "products".')
    .custom((value, { req }) => {
      if (value === 'products' && !Array.isArray(req.body.details) && !req.body.productId) {
        throw new Error('Details must be an array for multiple-products transfer && productId is required');
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
    } else if (type === 'products') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Details must be a non-empty array for multiple-products transfer');
      }

      for (const item of value) {
        const product = await Product.findById(item.productId);
        if (!product) {
          throw new Error(`Product with ID ${item.productId} not found`);
        }
        if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error('Each detail in products must include a valid productId and quantity > 0');
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

  // Required unless a foreign-currency transfer is given instead (`foreign_amount` is then the
  // authoritative amount - see services/accounting/moneyTransferService.js).
  check('amount')
    .if((value, { req }) => !req.body.currency || String(req.body.currency).trim().toUpperCase() === 'EGP')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ gt: 0 })
    .withMessage('Amount must be greater than 0'),

  check('withdraw_account').notEmpty().withMessage('A withdrawal account (Cash or Cash Equivalent) is required').isMongoId().withMessage('Invalid withdrawal account id').custom(eligiblePaymentAccount),

  check('deposit_account').notEmpty().withMessage('A deposit account (Cash or Cash Equivalent) is required').isMongoId().withMessage('Invalid deposit account id').custom(eligiblePaymentAccount),

  check('currency').optional({ nullable: true }).isString().trim().isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
  check('foreign_amount')
    .if((value, { req }) => !!req.body.currency && String(req.body.currency).trim().toUpperCase() !== 'EGP')
    .notEmpty()
    .withMessage('A foreign amount is required when a non-EGP currency is given')
    .isFloat({ gt: 0 })
    .withMessage('Foreign amount must be greater than 0'),
  check('date').optional({ nullable: true }).isISO8601().withMessage('Invalid date'),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),

  validatorMiddleware,
];
