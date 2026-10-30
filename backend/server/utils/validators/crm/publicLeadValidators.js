const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { normalizeEgyptianPhone } = require('../../crm/phone');

// Reservia CRM - validation for the PUBLIC website lead-intake endpoint
// (routes/crm/publicLeadRoute.js). Deliberately its OWN validator, not createLeadValidator
// (utils/validators/crm/leadValidators.js) - that one validates the CRM's own enums
// (segment/channel); this one validates what the WEBSITE actually sends (its own Segment type,
// 'contact_form'|'landing_form'), which services/crm/publicLeadIntakeService.js then maps.
//
// The honeypot field (`website`) is intentionally NOT validated/rejected here - a non-empty value
// is a signal the intake SERVICE acts on (silently skip), not a validation error (which would
// reveal the detection to whatever is submitting it).

const WEBSITE_SEGMENTS = ['villas', 'compounds', 'agriculture', 'industrial', 'service', 'general', 'calc'];
const WEBSITE_SOURCES = ['contact_form', 'landing_form'];

exports.publicLeadValidators = [
  check('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 150 }),
  check('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone is required.')
    .custom(value => {
      if (!normalizeEgyptianPhone(value)) throw new Error('Enter a valid Egyptian phone number.');
      return true;
    }),
  check('segment').trim().notEmpty().withMessage('Segment is required.').isIn(WEBSITE_SEGMENTS),
  check('source').trim().notEmpty().withMessage('Source is required.').isIn(WEBSITE_SOURCES),
  check('governorate').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('message').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  check('siteInput').optional({ nullable: true }).isFloat({ min: 0, max: 1_000_000 }),
  check('pageUrl').optional({ nullable: true }).isString().trim().isLength({ max: 300 }),
  check('lang').optional({ nullable: true }).isString().trim().isLength({ max: 10 }),
  check('eventId').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('ampDeviceId').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('utm').optional({ nullable: true }).isObject(),
  check('utm.utm_source').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  check('utm.utm_medium').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  check('utm.utm_campaign').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  check('calculator').optional({ nullable: true }).isObject(),
  check('calculator.systemSizeKwp').optional({ nullable: true }).isFloat({ min: 0, max: 100_000 }),
  check('calculator.indicativePriceEgp').optional({ nullable: true }).isFloat({ min: 0, max: 1_000_000_000 }),
  check('calculator.yearlySavingEgp').optional({ nullable: true }).isFloat({ min: -1_000_000_000, max: 1_000_000_000 }),
  check('calculator.paybackYears').optional({ nullable: true }).isFloat({ min: 0, max: 1000 }),
  // Honeypot: accepted as plain text, never required, never surfaced in an error message.
  check('website').optional({ nullable: true }).isString().isLength({ max: 500 }),
  validatorMiddleware,
];
