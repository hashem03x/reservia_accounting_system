const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

const lineValidators = (prefix = 'lines.*') => [
  check(`${prefix}.account`).notEmpty().withMessage('Account (GA) is required for every line').isMongoId().withMessage('Invalid account id'),
  check(`${prefix}.subAccount`).optional({ nullable: true }).isMongoId().withMessage('Invalid sub-account id'),
  check(`${prefix}.project`).optional({ nullable: true }).isMongoId().withMessage('Invalid project id'),
  check(`${prefix}.projectNumber`).optional({ nullable: true }).isString().trim(),
  check(`${prefix}.description`).optional({ nullable: true }).isString().trim().isLength({ max: 300 }),
  check(`${prefix}.debit`).optional().isFloat({ min: 0 }).withMessage('Debit must be a non-negative number'),
  check(`${prefix}.credit`).optional().isFloat({ min: 0 }).withMessage('Credit must be a non-negative number'),
  check(`${prefix}.unearnedRevenue`).optional().isFloat({ min: 0 }).withMessage('Unearned revenue must be a non-negative number'),
  check(prefix).custom(line => {
    const debit = Number(line?.debit) || 0;
    const credit = Number(line?.credit) || 0;
    if ((debit > 0) === (credit > 0)) {
      throw new Error('Each journal line must have either a debit or a credit amount, not both and not neither.');
    }
    return true;
  }),
];

const createJournalEntryValidators = [
  check('date').optional().isISO8601().withMessage('Invalid date'),
  check('description').optional().isString().trim().isLength({ max: 500 }),
  check('reference').optional().isString().trim().isLength({ max: 100 }),
  check('project').optional({ nullable: true }).isMongoId().withMessage('Invalid project id'),
  check('lines').isArray({ min: 1 }).withMessage('A journal entry needs at least one line'),
  ...lineValidators(),
  validatorMiddleware,
];

const updateJournalEntryValidators = [
  check('date').optional().isISO8601().withMessage('Invalid date'),
  check('description').optional().isString().trim().isLength({ max: 500 }),
  check('reference').optional().isString().trim().isLength({ max: 100 }),
  check('project').optional({ nullable: true }).isMongoId().withMessage('Invalid project id'),
  check('lines').optional().isArray({ min: 1 }).withMessage('A journal entry needs at least one line'),
  ...lineValidators(),
  validatorMiddleware,
];

// The reversal date is never defaulted to today/the original entry's date/the server clock - the
// admin must explicitly choose it (see docs/entities/accounting.md's "Reversal" section). Required
// here, not optional, so a request missing it is rejected before the controller ever runs.
const reverseJournalEntryValidators = [
  check('reversalDate').notEmpty().withMessage('Reversal date is required').isISO8601().withMessage('Invalid reversal date'),
  check('reference').optional().isString().trim().isLength({ max: 100 }),
  validatorMiddleware,
];

module.exports = { createJournalEntryValidators, updateJournalEntryValidators, reverseJournalEntryValidators };
