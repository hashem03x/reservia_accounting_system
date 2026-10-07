const { check } = require('express-validator');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// Only the fields this phase adds are validated here (name/bookValue/fairValue/warehouseId were
// never validated before this phase - see fixedAssetController.js - and adding strict validation
// to them now is out of scope / risks rejecting requests the pre-existing frontend already sends
// successfully).
const createFixedAssetValidators = [
  check('name').notEmpty().withMessage('Asset name is required').isString().trim(),
  check('warehouseId').notEmpty().withMessage('Warehouse is required').isMongoId().withMessage('Invalid warehouse id'),
  check('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a non-negative number'),
  check('bookValue').optional().isFloat({ min: 0 }).withMessage('Book value must be a non-negative number'),
  check('assetAccountId')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Invalid asset account id')
    .custom(value =>
      ChartOfAccount.findById(value).then(account => {
        if (!account) return Promise.reject(new Error('Selected account does not exist or is inactive.'));
        if (!account.isActive) return Promise.reject(new Error('Selected account does not exist or is inactive.'));
      })
    ),
  check('sourceAccountId')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Invalid source account id')
    .custom(value =>
      ChartOfAccount.findById(value).then(account => {
        if (!account) return Promise.reject(new Error('Selected account does not exist or is inactive.'));
        if (!account.isActive) return Promise.reject(new Error('Selected account does not exist or is inactive.'));
      })
    ),
  check('acquisitionDate').optional().isISO8601().withMessage('Invalid acquisition date'),
  check('notes').optional().isString().trim().isLength({ max: 1000 }),

  validatorMiddleware,
];

module.exports = { createFixedAssetValidators };
