const { check } = require('express-validator');
const Currency = require('../../models/accounting/currencyModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { isValidRate } = require('../exchangeRate');

const createCurrencyValidators = [
  check('code')
    .notEmpty()
    .withMessage('Currency code is required')
    .bail()
    .isString()
    .trim()
    .customSanitizer(value => value.toUpperCase())
    .matches(/^[A-Z]{3}$/)
    .withMessage('Currency code must be a 3-letter ISO 4217 code, e.g. EGP, USD, EUR')
    .custom(value =>
      Currency.findOne({ code: value }).then(currency => {
        if (currency) return Promise.reject(new Error('A currency with this code already exists.'));
      })
    ),

  check('name').notEmpty().withMessage('Currency name is required').isString().trim().isLength({ max: 100 }),
  check('symbol').optional({ nullable: true }).isString().trim().isLength({ max: 10 }),

  // EGP is the only currency ever created with isBaseCurrency - seeded once by
  // scripts/seedCurrencies.js, never through this endpoint (createCurrency ignores the field
  // entirely - see currencyController.js), so no validator is needed for it here.
  check('rate')
    .notEmpty()
    .withMessage('Exchange rate is required')
    .bail()
    .isFloat()
    .withMessage('Exchange rate must be a number')
    .bail()
    .custom(value => isValidRate(Number(value)))
    .withMessage('Exchange rate must be a finite number greater than zero'),

  check('isActive').optional().isBoolean(),

  validatorMiddleware,
];

const updateCurrencyValidators = [
  check('code')
    .optional()
    .isString()
    .trim()
    .customSanitizer(value => value.toUpperCase())
    .matches(/^[A-Z]{3}$/)
    .withMessage('Currency code must be a 3-letter ISO 4217 code, e.g. EGP, USD, EUR')
    .custom((value, { req }) =>
      Currency.findOne({ code: value, _id: { $ne: req.params.id } }).then(currency => {
        if (currency) return Promise.reject(new Error('A currency with this code already exists.'));
      })
    ),
  check('name').optional().isString().trim().isLength({ max: 100 }),
  check('symbol').optional({ nullable: true }).isString().trim().isLength({ max: 10 }),
  check('rate')
    .optional()
    .isFloat()
    .withMessage('Exchange rate must be a number')
    .bail()
    .custom(value => isValidRate(Number(value)))
    .withMessage('Exchange rate must be a finite number greater than zero'),
  check('isActive').optional().isBoolean(),

  validatorMiddleware,
];

module.exports = { createCurrencyValidators, updateCurrencyValidators };
