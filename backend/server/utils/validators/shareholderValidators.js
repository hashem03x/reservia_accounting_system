const { check } = require('express-validator');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { isPaymentAccountEligible } = require('../accountingConstants');
const { isValidEgyptianNationalId } = require('../egyptianNationalId');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// Fast pre-checks - the model (total ownership <= 100%, equity account type, National ID
// format/uniqueness) and services/equity/shareholderService.js (accounts, amount, Issued
// Capital/ownership gates) are the real backstops.
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
const nationalIdFormat = value => {
  if (!isValidEgyptianNationalId(value)) throw new Error('National ID must be a valid 14-digit Egyptian National ID.');
  return true;
};

const profileChecks = [
  check('phone').optional({ nullable: true }).isString().trim().isLength({ max: 30 }),
  check('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Invalid email'),
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
  field(`${prefix}idempotencyKey`, when).optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
];

exports.createShareholderValidators = [
  check('name').notEmpty().withMessage('Full name (English) is required').isString().trim().isLength({ max: 200 }),
  check('nameAr').notEmpty().withMessage('Full name (Arabic) is required').isString().trim().isLength({ max: 200 }),
  check('address').notEmpty().withMessage('Address is required').isString().trim().isLength({ max: 500 }),
  check('nationalId').notEmpty().withMessage('National ID is required').bail().isString().trim().custom(nationalIdFormat),
  check('ownershipPercentage').notEmpty().withMessage('Ownership percentage is required').isFloat({ gt: 0, max: 100 }).withMessage('Ownership percentage must be greater than 0 and at most 100'),
  check('equityAccount').notEmpty().withMessage('Equity account is required').isMongoId().withMessage('Invalid equity account id').custom(equityAccount),
  ...profileChecks,
  // Optional first contribution recorded with the shareholder.
  ...contributionChecks('contribution.', (value, { req }) => !!req.body.contribution?.amount),
  validatorMiddleware,
];

exports.updateShareholderValidators = [
  check('id').isMongoId().withMessage('Invalid shareholder id'),
  check('name').optional().notEmpty().withMessage('Full name (English) cannot be empty').isString().trim().isLength({ max: 200 }),
  check('nameAr').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  check('address').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  check('nationalId').optional({ nullable: true, checkFalsy: true }).isString().trim().custom(nationalIdFormat),
  check('ownershipPercentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Ownership percentage must be between 0 and 100'),
  check('equityAccount').optional().isMongoId().withMessage('Invalid equity account id').custom(equityAccount),
  ...profileChecks,
  validatorMiddleware,
];

exports.addContributionValidators = [check('id').isMongoId().withMessage('Invalid shareholder id'), ...contributionChecks(''), validatorMiddleware];

exports.setIssuedCapitalValidators = [
  check('issuedCapital').notEmpty().withMessage('Issued capital is required').isFloat({ gt: 0 }).withMessage('Issued capital must be greater than 0'),
  validatorMiddleware,
];

// Scenario 1 (brief): Issued Capital + N shareholders, created together. Each shareholder in the
// array is checked with the same per-field rules as createShareholderValidators above (kept
// explicit here rather than reused directly - express-validator's `.*.` array syntax needs its own
// check() calls, it cannot replay another chain) - the model's own validation (ownership totaling
// <= 100% together, National ID format/uniqueness, equity account eligibility) remains the real
// backstop either way.
exports.setupCapitalStructureValidators = [
  check('issuedCapital').notEmpty().withMessage('Issued capital is required').isFloat({ gt: 0 }).withMessage('Issued capital must be greater than 0'),
  check('shareholders').isArray({ min: 1 }).withMessage('At least one shareholder is required'),
  check('shareholders.*.name').notEmpty().withMessage('Full name (English) is required for every shareholder').isString().trim().isLength({ max: 200 }),
  check('shareholders.*.nameAr').notEmpty().withMessage('Full name (Arabic) is required for every shareholder').isString().trim().isLength({ max: 200 }),
  check('shareholders.*.address').notEmpty().withMessage('Address is required for every shareholder').isString().trim().isLength({ max: 500 }),
  check('shareholders.*.nationalId').notEmpty().withMessage('National ID is required for every shareholder').bail().isString().trim().custom(nationalIdFormat),
  check('shareholders.*.ownershipPercentage')
    .notEmpty()
    .withMessage('Ownership percentage is required for every shareholder')
    .isFloat({ gt: 0, max: 100 })
    .withMessage('Ownership percentage must be greater than 0 and at most 100'),
  check('shareholders.*.equityAccount').notEmpty().withMessage('Equity account is required for every shareholder').isMongoId().withMessage('Invalid equity account id').custom(equityAccount),
  validatorMiddleware,
];
