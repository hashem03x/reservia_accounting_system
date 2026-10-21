const { check } = require('express-validator');
const mongoose = require('mongoose');
const Project = require('../../models/project/projectModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { userHasPermission } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../appConstant');
const { isValidRate } = require('../currencyMath');

// Mirrors journalEntryModel.js's own `round2` - kept in sync deliberately rather than imported,
// since the model doesn't export it; this is only ever used for this fast pre-check, the model's
// own pre('save') hook (using its own round2) remains the real backstop (see docs section
// "Validate Both Debit and Credit Totals" - must use the project's existing precision strategy,
// not a fresh floating-point comparison).
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// RULE 1 fast pre-check: computed from the actual `lines` in the request body, never trusted from
// a client-submitted `difference`/`totalDebit`/`totalCredit` field (docs section "Do not trust a
// difference value sent from the frontend"). Applies unconditionally - there is no `status`
// exception, including for `draft` (docs section "Very Important: Drafts Are NOT Exempt").
const linesAreBalanced = check('lines').custom(lines => {
  if (!Array.isArray(lines) || lines.length === 0) return true; // handled by the separate isArray({min:1}) check
  const totalDebit = round2(lines.reduce((sum, l) => sum + (Number(l?.debit) || 0), 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + (Number(l?.credit) || 0), 0));
  if (totalDebit !== totalCredit) {
    throw new Error('Journal entry is not balanced. Total debit must equal total credit.');
  }
  return true;
});

// Every manual line needs a description and may carry a Sub Account (partyType + partyNumber) -
// whether the sub-account fits the account is checked by journalLinePartyService.js (model hook).
const lineValidators = (prefix = 'lines.*') => [
  check(`${prefix}.account`).notEmpty().withMessage('Account (GA) is required for every line').isMongoId().withMessage('Invalid account id'),
  check(`${prefix}.subAccount`).optional({ nullable: true }).isMongoId().withMessage('Invalid sub-account id'),
  check(`${prefix}.project`).optional({ nullable: true }).isMongoId().withMessage('Invalid project id'),
  check(`${prefix}.projectNumber`).optional({ nullable: true }).isString().trim(),
  check(`${prefix}.description`).isString().withMessage('A description is required for every line').trim().notEmpty().withMessage('A description is required for every line').isLength({ max: 300 }),
  check(`${prefix}.partyType`).optional({ nullable: true }).isIn(['customer', 'vendor', 'shareholder']).withMessage('Invalid sub-account type'),
  check(`${prefix}.partyNumber`).optional({ nullable: true }).isInt({ min: 0 }).withMessage('Invalid sub-account number'),
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

// RULE 2 fast pre-check: project is mandatory for a manually-created journal entry (this is the
// create endpoint the Journal Entries form submits to - reversal/fixed-asset-purchase auto-entries
// never go through this validator, see journalEntryModel.js's identical exemption comment).
//
// Journal Entry Project / General selection (docs section "Journal Entry Project Selection -
// Project or General"): a request with NO project is only accepted for a user who holds the
// journalEntries:createGeneral permission (adminPermission only - see appConstant.js) - checked
// here, on the BACKEND, never inferred from frontend visibility alone. `req.user` is already
// populated by `authController.protect`, which always runs before this validator chain on the
// mounted route (journalEntryRoute.js).
const projectRequired = check('project').custom((value, { req }) => {
  if (value) {
    if (!mongoose.Types.ObjectId.isValid(value)) throw new Error('Invalid project id');
    return Project.findById(value).then(project => {
      if (!project) return Promise.reject(new Error('The selected project does not exist.'));
    });
  }

  if (!userHasPermission(req.user, Resources.journalEntries, Actions.createGeneral)) {
    throw new Error('Project is required when creating a journal entry.');
  }
  return true;
});

// Currency Manager: an optional transaction currency (3-letter code; omitted = EGP) and applied
// rate (1 EGP = X units; omitted = the currency's rate on the entry date). Whether the code is a
// configured, active currency is decided by currencyService.resolveEntryCurrency.
const currencyValidators = [
  check('currency').optional({ nullable: true }).isString().withMessage('Invalid currency').bail().trim().matches(/^[A-Za-z]{3}$/).withMessage('Currency must be a 3-letter code'),
  check('exchangeRate')
    .optional({ nullable: true })
    .custom(value => {
      if (value === '') return true;
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (typeof value === 'boolean' || !isValidRate(n)) throw new Error('Exchange rate must be a finite number greater than zero');
      return true;
    }),
  // Line currency fields (currency, exchangeRate, currencyDebit, currencyCredit) are always derived
  // by the server - any client value is discarded by journalEntryCurrencyService.js.
];

const createJournalEntryValidators = [
  check('date').optional().isISO8601().withMessage('Invalid date'),
  ...currencyValidators,
  check('description').optional().isString().trim().isLength({ max: 500 }),
  check('reference').optional().isString().trim().isLength({ max: 100 }),
  projectRequired,
  check('lines').isArray({ min: 1 }).withMessage('A journal entry needs at least one line'),
  linesAreBalanced,
  ...lineValidators(),
  validatorMiddleware,
];

const updateJournalEntryValidators = [
  check('date').optional().isISO8601().withMessage('Invalid date'),
  ...currencyValidators,
  check('description').optional().isString().trim().isLength({ max: 500 }),
  check('reference').optional().isString().trim().isLength({ max: 100 }),
  // Project stays optional on update (not re-required retroactively) - see docs section "Check
  // Existing Journal Entries": the new mandatory rule applies to new creation, not to editing a
  // pre-existing entry that may predate it.
  check('project').optional({ nullable: true }).isMongoId().withMessage('Invalid project id'),
  check('lines').optional().isArray({ min: 1 }).withMessage('A journal entry needs at least one line'),
  linesAreBalanced,
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
