const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');

const { PaymentMethods } = require('../appConstant');

// Required going forward (docs section "Payment Methods Must Come From Chart of Accounts") - the
// old hardcoded `paymentMethod` enum below is kept only as an optional field for any caller that
// hasn't migrated yet; this is the real pre-check, backed by the model's own pre('save') hook in
// paymentModel.js, which re-verifies eligibility against the live account regardless of which code
// path writes to the document.
const paymentAccountValidator = check('paymentAccount')
  .notEmpty()
  .withMessage('A payment account is required')
  .isMongoId()
  .withMessage('Invalid payment account ID')
  .custom(async value => {
    const account = await ChartOfAccount.findById(value);
    if (!account) throw new Error('The selected payment account does not exist');
    if (account.type !== 'asset' || !['cash', 'cash-equivalent'].includes(account.state)) {
      throw new Error('The selected payment account must be a Cash or Cash Equivalent account');
    }
    return true;
  });

// Optional/legacy - not required any more now that `paymentAccount` is the primary field, but
// still validated against the known list when a caller does send it, so historical integrations
// aren't abruptly broken.
const paymentMethodValidator = check('paymentMethod').optional({ nullable: true }).isIn(PaymentMethods).withMessage('Invalid payment method');

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

    paymentAccountValidator,
    paymentMethodValidator,

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

    paymentAccountValidator,
    paymentMethodValidator,

    check('notes')
        .optional()
        .isString()
        .withMessage('Notes must be a string'),

    validatorMiddleware,
];
