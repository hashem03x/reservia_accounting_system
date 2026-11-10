const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { normalizeEgyptianPhone } = require('../../crm/phone');
const { parseSubmissionTimestamp } = require('../../crm/businessDate');
const { SEGMENTS, GOVERNORATE_NAMES_EN, INTEGRATION_CHANNEL_IDS } = require('../../crm/constants');

// Reservia CRM - payload validation for POST /api/v1/crm/integrations/:channel/leads (Change
// Request 2, item 6). One documented shape for every channel (docs/crm-integrations.md); each
// error names the field and what to send instead.

const text = (field, max) => check(field).optional({ nullable: true }).isString().withMessage(`${field} must be text.`).trim().isLength({ max }).withMessage(`${field} is longer than ${max} characters.`);

exports.unifiedLeadValidators = [
  check('externalId')
    .exists({ checkFalsy: true })
    .withMessage("externalId is required - send the platform's own lead/event id so a retried delivery is never processed twice.")
    .bail()
    .isString()
    .trim()
    .isLength({ max: 150 }),
  check('phone')
    .exists({ checkFalsy: true })
    .withMessage('phone is required.')
    .bail()
    .custom(value => {
      if (!normalizeEgyptianPhone(value)) throw new Error('phone must be an Egyptian number (e.g. 01012345678 or +201012345678).');
      return true;
    }),
  text('name', 150),
  check('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('email is not a valid email address.'),
  check('segment').optional({ nullable: true }).isIn(SEGMENTS).withMessage(`segment must be one of: ${SEGMENTS.join(', ')}.`),
  check('governorate').optional({ nullable: true }).isIn(GOVERNORATE_NAMES_EN).withMessage('governorate must be one of the 27 governorate names in English (e.g. Giza).'),
  text('campaign', 200),
  text('adSetName', 200),
  text('adName', 200),
  text('formId', 100),
  text('platform', 40),
  text('message', 2000),
  text('source', 40),
  text('pageUrl', 300),
  text('referrer', 300),
  check('submittedAt')
    .optional({ nullable: true })
    .custom(value => {
      if (!parseSubmissionTimestamp(value)) throw new Error('submittedAt must be ISO 8601 with a timezone (2026-11-09T10:00:00+02:00) or a Unix timestamp.');
      return true;
    }),
  check('utm').optional({ nullable: true }).isObject().withMessage('utm must be an object.'),
  ...['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].map(k => text(`utm.${k}`, 150)),
  check('answers').optional({ nullable: true }).isObject().withMessage('answers must be an object of extra form answers.'),
  validatorMiddleware,
];

exports.createKeyValidators = [
  check('channel').isIn(INTEGRATION_CHANNEL_IDS).withMessage(`channel must be one of: ${INTEGRATION_CHANNEL_IDS.join(', ')}.`),
  text('label', 100),
  validatorMiddleware,
];

exports.keyIdValidator = [check('id').isMongoId().withMessage('Invalid key id.'), validatorMiddleware];
