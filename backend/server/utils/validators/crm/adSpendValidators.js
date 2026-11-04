const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { SOURCES } = require('../../crm/constants');

exports.setAdSpendValidator = [
  check('source').isIn(SOURCES).withMessage('Invalid source'),
  check('year').isInt({ min: 2020, max: 2100 }).withMessage('Invalid year'),
  check('month').isInt({ min: 1, max: 12 }).withMessage('Invalid month'),
  check('amountEgp').isFloat({ min: 0 }).withMessage('amountEgp must be a non-negative number'),
  validatorMiddleware,
];

exports.listAdSpendValidator = [
  check('year').isInt({ min: 2020, max: 2100 }).withMessage('Invalid year'),
  check('month').isInt({ min: 1, max: 12 }).withMessage('Invalid month'),
  validatorMiddleware,
];
