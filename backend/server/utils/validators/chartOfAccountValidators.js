const { check } = require('express-validator');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { AccountTypes, AccountStates } = require('../accountingConstants');

const createChartOfAccountValidators = [
  check('code')
    .notEmpty()
    .withMessage('Account code is required')
    .isString()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Account code cannot exceed 20 characters')
    .custom(value =>
      ChartOfAccount.findOne({ code: value }).then(account => {
        if (account) return Promise.reject(new Error('An account with this code already exists.'));
      })
    ),

  check('name').notEmpty().withMessage('Account name is required').isString().trim().isLength({ max: 100 }),
  check('nameAr').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),

  check('type').notEmpty().withMessage('Account type is required').isIn(AccountTypes).withMessage(`Account type must be one of: ${AccountTypes.join(', ')}`),
  check('state').optional({ nullable: true }).isIn(AccountStates).withMessage(`Account state must be one of: ${AccountStates.join(', ')}`),

  check('parentAccount')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Invalid parent account id')
    .custom(value =>
      ChartOfAccount.findById(value).then(account => {
        if (!account) return Promise.reject(new Error('Parent account does not exist.'));
      })
    ),

  check('description').optional().isString().trim().isLength({ max: 500 }),
  check('isActive').optional().isBoolean(),

  validatorMiddleware,
];

const updateChartOfAccountValidators = [
  check('code')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 20 })
    .custom((value, { req }) =>
      ChartOfAccount.findOne({ code: value, _id: { $ne: req.params.id } }).then(account => {
        if (account) return Promise.reject(new Error('An account with this code already exists.'));
      })
    ),
  check('name').optional().isString().trim().isLength({ max: 100 }),
  check('nameAr').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('type').optional().isIn(AccountTypes).withMessage(`Account type must be one of: ${AccountTypes.join(', ')}`),
  check('state').optional({ nullable: true }).isIn(AccountStates).withMessage(`Account state must be one of: ${AccountStates.join(', ')}`),
  check('parentAccount')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Invalid parent account id')
    .custom((value, { req }) => {
      if (value === req.params.id) return Promise.reject(new Error('An account cannot be its own parent.'));
      return ChartOfAccount.findById(value).then(account => {
        if (!account) return Promise.reject(new Error('Parent account does not exist.'));
      });
    }),
  check('description').optional().isString().trim().isLength({ max: 500 }),
  check('isActive').optional().isBoolean(),

  validatorMiddleware,
];

module.exports = { createChartOfAccountValidators, updateChartOfAccountValidators };
