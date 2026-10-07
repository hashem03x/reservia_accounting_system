const { check } = require('express-validator');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { AccountTypes, AccountStates, isPucAccountEligible } = require('../accountingConstants');

// `wipAccount` (COGS accounts only): the PUC/WIP account the COGS category's project costs are
// relieved from - see chartOfAccountModel.js#wipAccount. Same eligibility rule as a Service's PUC
// account (isPucAccountEligible), so both dropdowns offer exactly the same accounts.
const wipAccountCheck = resolveType =>
  check('wipAccount')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Invalid WIP account id')
    .custom(async (value, { req }) => {
      if ((await resolveType(req)) !== 'cogs') throw new Error('Only a COGS account can have a WIP (PUC) account.');
      const wip = await ChartOfAccount.findById(value).lean();
      if (!wip) throw new Error('The selected WIP account does not exist.');
      if (!isPucAccountEligible(wip)) throw new Error(`Account "${wip.code} - ${wip.name}" cannot be a WIP account - it must be an active asset (PUC) account that is not a cash/bank account.`);
      return true;
    });

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
  wipAccountCheck(async req => req.body.type),

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
  // The update endpoint uses findByIdAndUpdate (no document hooks), so this is the real check here.
  wipAccountCheck(async req => req.body.type || (await ChartOfAccount.findById(req.params.id).select('type').lean())?.type),

  validatorMiddleware,
];

module.exports = { createChartOfAccountValidators, updateChartOfAccountValidators };
