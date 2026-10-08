const { check } = require('express-validator');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { isPaymentAccountEligible } = require('../accountingConstants');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// Fast pre-checks - the model (total ownership <= 100%, equity account type) and
// services/equity/shareholderService.js (accounts, amount) are the real backstops.
const equityAccount = async value => {
  const account = await ChartOfAccount.findById(value);
  if (!account || account.isActive === false || account.type !== 'equity') throw new Error('The equity account must be an active Chart of Accounts equity account.');
  return true;
};
const paymentAccount = async value => {
  const account = await ChartOfAccount.findById(value);
  if (!account) throw new Error('The selected payment account does not exist');
  if (!isPaymentAccountEligible(account)) throw new Error('The selected payment account must be a Cash or Cash Equivalent account');
  return true;
};

const profileChecks = [
  check('phone').optional({ nullable: true }).isString().trim().isLength({ max: 30 }),
  check('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Invalid email'),
  check('nationalId').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  check('status').optional().isIn(['active', 'inactive']).withMessage('Status must be active or inactive'),
];

// `when` (optional) must be applied before the validators - express-validator's .if() only guards
// what follows it in the chain.
const field = (name, when) => (when ? check(name).if(when) : check(name));
const contributionChecks = (prefix, when) => [
  field(`${prefix}amount`, when).notEmpty().withMessage('Contribution amount is required').isFloat({ gt: 0 }).withMessage('Contribution amount must be greater than 0'),
  field(`${prefix}paymentAccount`, when).notEmpty().withMessage('A payment account (Cash or Cash Equivalent) is required').isMongoId().withMessage('Invalid payment account id').custom(paymentAccount),
  field(`${prefix}equityAccount`, when).optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid equity account id').custom(equityAccount),
  field(`${prefix}date`, when).optional({ nullable: true }).isISO8601().withMessage('Invalid date'),
  field(`${prefix}reference`, when).optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  field(`${prefix}notes`, when).optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
];

exports.createShareholderValidators = [
  check('name').notEmpty().withMessage('Shareholder name is required').isString().trim().isLength({ max: 200 }),
  check('ownershipPercentage').notEmpty().withMessage('Ownership percentage is required').isFloat({ min: 0, max: 100 }).withMessage('Ownership percentage must be between 0 and 100'),
  check('equityAccount').notEmpty().withMessage('Equity account is required').isMongoId().withMessage('Invalid equity account id').custom(equityAccount),
  ...profileChecks,
  // Optional first contribution recorded with the shareholder.
  ...contributionChecks('contribution.', (value, { req }) => !!req.body.contribution?.amount),
  validatorMiddleware,
];

exports.updateShareholderValidators = [
  check('id').isMongoId().withMessage('Invalid shareholder id'),
  check('name').optional().notEmpty().withMessage('Shareholder name cannot be empty').isString().trim().isLength({ max: 200 }),
  check('ownershipPercentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Ownership percentage must be between 0 and 100'),
  check('equityAccount').optional().isMongoId().withMessage('Invalid equity account id').custom(equityAccount),
  ...profileChecks,
  validatorMiddleware,
];

exports.addContributionValidators = [check('id').isMongoId().withMessage('Invalid shareholder id'), ...contributionChecks(''), validatorMiddleware];
