const { check } = require('express-validator');
const User = require('../../models/userModel');
const Vendor = require('../../models/vendor/vendor');
const Project = require('../../models/project/projectModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// Fast pre-check, mirroring projectValidators.js's deliveryNotBeforeStart convention - the model's
// own pre('validate') hook (advancedPaymentModel.js) is the real backstop for every case this
// can't see (e.g. a project that gets reassigned to a different customer after this check runs).
const createAdvancedPaymentValidators = [
  check('type').notEmpty().withMessage('Advanced payment type is required').isIn(['customer', 'vendor']).withMessage('Type must be "customer" or "vendor"'),

  check('customer')
    .if((value, { req }) => req.body.type === 'customer')
    .notEmpty()
    .withMessage('Customer is required for a customer advanced payment')
    .isMongoId()
    .withMessage('Invalid customer id')
    .custom(value =>
      User.findById(value).then(user => {
        if (!user) return Promise.reject(new Error('Customer does not exist.'));
      })
    ),

  check('vendor')
    .if((value, { req }) => req.body.type === 'vendor')
    .notEmpty()
    .withMessage('Vendor is required for a vendor advanced payment')
    .isMongoId()
    .withMessage('Invalid vendor id')
    .custom(value =>
      Vendor.findById(value).then(vendor => {
        if (!vendor) return Promise.reject(new Error('Vendor does not exist.'));
      })
    ),

  check('project')
    .if((value, { req }) => req.body.type === 'customer')
    .notEmpty()
    .withMessage('Project is required for a customer advanced payment')
    .isMongoId()
    .withMessage('Invalid project id')
    .custom((value, { req }) =>
      Project.findById(value).then(project => {
        if (!project) return Promise.reject(new Error('Project not found.'));
        // Project.findById() runs Project's own populate hook, turning `.customer` into
        // `{_id, name, ...}` - see advancedPaymentModel.js's identical comment.
        const projectCustomerId = project.customer?._id || project.customer;
        if (req.body.type === 'customer' && (!projectCustomerId || projectCustomerId.toString() !== String(req.body.customer))) {
          return Promise.reject(new Error('This project does not belong to the selected customer.'));
        }
      })
    ),
  // Optional for vendor advances, but still validated when provided.
  check('project').if((value, { req }) => req.body.type === 'vendor' && value).isMongoId().withMessage('Invalid project id'),

  check('amount').notEmpty().withMessage('Amount is required').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),

  // Optional - the automatic accounting engine (ADVANCE_PAYMENT_RECEIVED_CUSTOMER/
  // ADVANCE_PAYMENT_PAID_VENDOR, see accountingEventService.js) only posts a journal entry when
  // this is set. Fast pre-check mirroring poValidator.js's identical paymentAccount check - the
  // model's own pre('validate') hook is the real backstop.
  check('paymentAccount')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Payment account ID must be a mongoID')
    .custom(async value => {
      const account = await ChartOfAccount.findById(value);
      if (!account) throw new Error('The selected payment account does not exist');
      if (account.type !== 'asset' || !['cash', 'cash-equivalent'].includes(account.state)) {
        throw new Error('The selected payment account must be a Cash or Cash Equivalent account');
      }
      return true;
    }),

  check('currency').optional({ nullable: true }).isString().trim().isLength({ max: 10 }),
  check('reference').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),

  validatorMiddleware,
];

module.exports = { createAdvancedPaymentValidators };
