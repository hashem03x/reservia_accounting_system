const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Vendor = require('../../models/vendor/vendor');
const Warehouse = require('../../models/inventory/warehouseModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { isPaymentAccountEligible } = require('../accountingConstants');

// Fast pre-checks - services/expenses/expenseService.js re-checks the accounts and the amount
// still owed inside the transaction.
const vendorExists = async value => {
  if (!(await Vendor.findById(value))) throw new Error('Vendor does not exist.');
  return true;
};
const eligiblePaymentAccount = async value => {
  const account = await ChartOfAccount.findById(value);
  if (!account) throw new Error('The selected payment account does not exist');
  if (!isPaymentAccountEligible(account)) throw new Error('The selected payment account must be a Cash or Cash Equivalent account');
  return true;
};
const warehouseExists = async value => {
  if (!(await Warehouse.findById(value))) throw new Error('Warehouse does not exist.');
  return true;
};

exports.createExpenseValidator = [
  check('vendor').notEmpty().withMessage('Vendor is required').isMongoId().withMessage('Invalid vendor id').custom(vendorExists),
  check('expenseAccount')
    .notEmpty()
    .withMessage('Expense account is required')
    .isMongoId()
    .withMessage('Invalid expense account id')
    .custom(async value => {
      const account = await ChartOfAccount.findById(value);
      if (!account || account.isActive === false || account.type !== 'expense') throw new Error('The expense account must be an active Chart of Accounts expense account.');
      return true;
    }),
  check('amount').notEmpty().withMessage('Amount is required').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  check('vatPercentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('VAT percentage must be between 0 and 100'),
  check('date').optional({ nullable: true }).isISO8601().withMessage('Invalid date'),
  check('reference').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  check('category').optional({ nullable: true }).isMongoId().withMessage('Invalid expense category id'),
  // Optional immediate payment.
  check('payment.paymentAccount').optional({ nullable: true }).isMongoId().withMessage('Invalid payment account id').custom(eligiblePaymentAccount),
  check('payment.warehouseId')
    .if((value, { req }) => !!req.body.payment?.paymentAccount)
    .notEmpty()
    .withMessage('A warehouse is required to record the payment')
    .isMongoId()
    .withMessage('Invalid warehouse id')
    .custom(warehouseExists),
  check('payment.amount').optional({ nullable: true }).isFloat({ gt: 0 }).withMessage('Payment amount must be greater than 0'),
  validatorMiddleware,
];

exports.addExpensePaymentValidator = [
  check('id').isMongoId().withMessage('Invalid expense id'),
  check('amount').notEmpty().withMessage('Amount is required').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  check('paymentAccount').notEmpty().withMessage('A payment method (Cash or Cash Equivalent account) is required').isMongoId().withMessage('Invalid payment account id').custom(eligiblePaymentAccount),
  check('warehouseId').notEmpty().withMessage('Warehouse is required').isMongoId().withMessage('Invalid warehouse id').custom(warehouseExists),
  check('date').optional({ nullable: true }).isISO8601().withMessage('Invalid date'),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  validatorMiddleware,
];

exports.updateExpenseValidator = [
  check('id').isMongoId().withMessage('Invalid expense id'),
  check('category').optional({ nullable: true }).custom(value => value === '' || /^[a-f\d]{24}$/i.test(String(value))).withMessage('Invalid expense category id'),
  check('reference').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  validatorMiddleware,
];
