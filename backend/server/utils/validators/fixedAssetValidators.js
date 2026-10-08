const { check } = require('express-validator');
const Vendor = require('../../models/vendor/vendor');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// Fast pre-checks - the Chart of Accounts group rules for the three accounts are enforced by
// services/fixedAssets/fixedAssetAccounts.js#resolveFixedAssetAccounts inside the create transaction.
const createFixedAssetValidators = [
  check('name').notEmpty().withMessage('Asset name is required').isString().trim().isLength({ max: 200 }),
  check('vendor')
    .notEmpty()
    .withMessage('Vendor is required')
    .isMongoId()
    .withMessage('Invalid vendor id')
    .custom(async value => {
      if (!(await Vendor.findById(value))) throw new Error('Vendor does not exist.');
      return true;
    }),
  check('assetAccountId').notEmpty().withMessage('Asset account is required').isMongoId().withMessage('Invalid asset account id'),
  check('accumulatedAccountId').notEmpty().withMessage('Accumulated depreciation / amortization account is required').isMongoId().withMessage('Invalid accumulated account id'),
  check('depreciationAccountId').notEmpty().withMessage('Depreciation & Amortization account is required').isMongoId().withMessage('Invalid depreciation account id'),
  check('acquisitionDate').notEmpty().withMessage('Asset date is required').isISO8601().withMessage('Invalid asset date'),
  check('price').notEmpty().withMessage('Cost is required').isFloat({ gt: 0 }).withMessage('Cost must be greater than 0'),
  check('usefulLifeMonths').notEmpty().withMessage('Useful life in months is required').isInt({ gt: 0 }).withMessage('Useful life in months must be a whole number greater than 0'),
  check('vatPercentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('VAT percentage must be between 0 and 100'),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  validatorMiddleware,
];

const updateFixedAssetValidators = [
  check('id').isMongoId().withMessage('Invalid fixed asset id'),
  check('name').optional().notEmpty().withMessage('Asset name cannot be empty').isString().trim().isLength({ max: 200 }),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  check('status').optional().isIn(['active', 'under_maintenance', 'disposed']).withMessage('Status must be active, under_maintenance or disposed'),
  validatorMiddleware,
];

const runDepreciationValidators = [
  check('period')
    .notEmpty()
    .withMessage('Depreciation month is required')
    .matches(/^\d{4}-(0[1-9]|1[0-2])$/)
    .withMessage('Depreciation month must be in YYYY-MM format'),
  validatorMiddleware,
];

module.exports = { createFixedAssetValidators, updateFixedAssetValidators, runDepreciationValidators };
