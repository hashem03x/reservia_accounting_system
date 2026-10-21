const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { isValidRate } = require('../currencyMath');

// Fast request checks for /currencies. Business rules (unique code, EGP base invariants, delete
// protection, concurrent edits) are decided by services/accounting/currencyService.js and backed
// by the model's own validation and unique indexes.

// `:id` accepts either a Mongo id or a 3-letter currency code (GET /currencies/USD).
const idParam = check('id')
  .custom(value => /^[a-fA-F0-9]{24}$/.test(value) || /^[A-Za-z]{3}$/.test(value))
  .withMessage('Invalid currency id or code');

// Rates arrive as numbers or numeric strings; anything that is not a finite number > 0 is refused.
const rateRule = (field, { optional }) => {
  const chain = optional ? check(field).optional({ nullable: true }) : check(field).exists({ checkNull: true }).withMessage('Exchange rate is required').bail();
  return chain.custom(value => {
    if (optional && (value === null || value === '')) return true;
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (typeof value === 'boolean' || String(value).trim() === '' || !isValidRate(n)) throw new Error('Exchange rate must be a finite number greater than zero');
    return true;
  });
};

const textRule = (field, label, max, { required = false } = {}) => {
  const chain = required ? check(field) : check(field).optional({ nullable: true });
  let rule = chain.isString().withMessage(`${label} must be text`).bail().trim();
  if (required) rule = rule.notEmpty().withMessage(`${label} is required`);
  return rule.isLength({ max }).withMessage(`${label} cannot exceed ${max} characters`);
};

const common = [
  textRule('nameAr', 'Arabic name', 60),
  textRule('symbol', 'Currency symbol', 8),
  check('rateEffectiveDate').optional({ nullable: true }).isISO8601().withMessage('Invalid rate effective date'),
  check('isActive').optional().isBoolean({ strict: true }).withMessage('isActive must be true or false'),
];

exports.getCurrencyValidator = [idParam, validatorMiddleware];

exports.getCurrencyRateValidator = [idParam, check('date').optional().isISO8601().withMessage('Invalid date'), validatorMiddleware];

exports.createCurrencyValidator = [
  check('code')
    .isString()
    .withMessage('Currency code is required')
    .bail()
    .trim()
    .matches(/^[A-Za-z]{3}$/)
    .withMessage('Currency code must be exactly 3 letters (e.g. USD)'),
  textRule('name', 'Currency name', 60, { required: true }),
  rateRule('unitsPerBase', { optional: false }),
  ...common,
  validatorMiddleware,
];

exports.updateCurrencyValidator = [
  idParam,
  // The code is the identity journal entries reference - it can never be changed.
  check('code').not().exists().withMessage('The currency code cannot be changed'),
  check('name').optional().isString().withMessage('Currency name must be text').bail().trim().notEmpty().withMessage('Currency name is required').isLength({ max: 60 }),
  rateRule('unitsPerBase', { optional: true }),
  check('expectedVersion').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Invalid version'),
  ...common,
  validatorMiddleware,
];

exports.deleteCurrencyValidator = [idParam, validatorMiddleware];
