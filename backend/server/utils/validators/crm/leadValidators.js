const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { normalizeEgyptianPhone } = require('../../crm/phone');
const { FORM_SEGMENTS, CHANNELS, LOST_REASONS, SOURCES, GOVERNORATE_NAMES_EN } = require('../../crm/constants');
const { STAGES } = require('../../crm/stageRules');
const { toDateOnly } = require('../../crm/businessDate');

exports.createLeadValidator = [
  check('phone')
    .notEmpty()
    .withMessage('Phone number is required')
    .custom(value => {
      if (!normalizeEgyptianPhone(value)) throw new Error('Enter a valid Egyptian phone number.');
      return true;
    }),
  check('channel').notEmpty().withMessage('Channel is required').isIn(CHANNELS).withMessage('Invalid channel'),
  check('name').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  // Acceptance report finding 4: fixed lists, not free text - FORM_SEGMENTS/SOURCES/
  // GOVERNORATE_NAMES_EN are what the "New Lead" form may now submit. The Lead schema fields
  // themselves stay plain strings (leadModel.js's own comment on why) so this never blocks editing
  // an existing lead whose value predates these lists; only NEW submissions through this validator
  // are constrained to them.
  check('segment').optional({ nullable: true }).isIn(FORM_SEGMENTS).withMessage('Invalid segment'),
  check('governorate').optional({ nullable: true }).isIn(GOVERNORATE_NAMES_EN).withMessage('Invalid governorate'),
  // Change Request 1, Feature 1/4: "Manually entered lead -> user must select source" / "Do not
  // default manually created leads to Other" - source is REQUIRED here for every channel except
  // whatsapp, whose source is resolved automatically from the Ref code (or "WhatsApp Direct")
  // server-side, never typed by whoever is logging the message.
  check('source')
    .if((value, { req }) => req.body.channel !== 'whatsapp')
    .notEmpty()
    .withMessage('Choose how this lead found us (the source).')
    .bail()
    .isIn(SOURCES)
    .withMessage('Invalid source'),
  check('source').if((value, { req }) => req.body.channel === 'whatsapp').optional({ nullable: true }).isIn(SOURCES).withMessage('Invalid source'),
  check('partnerName').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  check('monthlyBillEgp').optional({ nullable: true }).isFloat({ min: 0 }),
  check('systemSizeKwp').optional({ nullable: true }).isFloat({ min: 0 }),
  check('valueEgp').optional({ nullable: true }).isFloat({ min: 0 }),
  check('owner').optional({ nullable: true }).isMongoId().withMessage('Invalid owner id'),
  check('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Enter a valid email address.').isLength({ max: 200 }),
  check('campaign').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  validatorMiddleware,
];

exports.leadIdValidator = [check('id').isMongoId().withMessage('Invalid lead id'), validatorMiddleware];

// Change Request 1, Feature 6: archiving (never restoring) requires a reason - enforced here as
// well as in the service (defense in depth), so a direct API call with no reason is rejected
// before ever reaching leadService.js#setLeadArchived.
exports.archiveLeadValidator = [
  check('id').isMongoId().withMessage('Invalid lead id'),
  check('reason').trim().notEmpty().withMessage('A reason is required to archive a lead.').isLength({ max: 300 }),
  validatorMiddleware,
];

exports.changeStageValidator = [
  check('id').isMongoId().withMessage('Invalid lead id'),
  check('to').notEmpty().withMessage('Target stage is required').isIn(STAGES).withMessage('Invalid stage'),
  check('lostReason')
    .if((value, { req }) => req.body.to === 'lost')
    .notEmpty()
    .withMessage('Choose a lost reason.')
    .isIn(LOST_REASONS)
    .withMessage('Invalid lost reason'),
  check('valueEgp').optional({ nullable: true }).isFloat({ min: 0 }),
  // Change Request 2, item 2: a follow-up is a calendar date. 'YYYY-MM-DD' is the expected form
  // and is stored verbatim; a full ISO timestamp from an older client is still accepted and
  // converted to its Cairo calendar day by the Lead model (never re-shifted through UTC).
  check('followUpAt')
    .optional({ nullable: true })
    .custom(value => {
      if (toDateOnly(value) === undefined) throw new Error('Follow-up date must be a real calendar date (YYYY-MM-DD).');
      return true;
    }),
  // Change Request 2, item 1: MD-only override reason. Its presence from a non-MD is rejected by
  // the service (403) - the server-side role decides, never this field.
  check('overrideReason').optional({ nullable: true }).isString().withMessage('Override reason must be text.').trim().isLength({ max: 500 }),
  // mdApproved is deliberately NOT accepted here - services/crm/leadService.js#changeStage never
  // trusts a client-supplied approval flag (a request body is not proof the MD approved
  // anything); only the acting role genuinely being 'md' can satisfy the >EGP 1M rule.
  validatorMiddleware,
];

exports.reassignLeadValidator = [
  check('id').isMongoId().withMessage('Invalid lead id'),
  check('owner').optional({ nullable: true }).isMongoId().withMessage('Invalid owner id'),
  validatorMiddleware,
];

exports.recordActivityValidator = [
  check('id').isMongoId().withMessage('Invalid lead id'),
  // 'whatsapp_out' (Change Request 2, item 3): a rep logging a WhatsApp message they sent from
  // the sales phone - one of the agreed first-reply events. 'whatsapp_in'/'system' stay
  // server-only (webhook / automation), never typed in by a user.
  check('type')
    .notEmpty()
    .withMessage('Activity type is required')
    .isIn(['note', 'call', 'email', 'whatsapp_out', 'survey', 'proposal'])
    .withMessage('Invalid activity type'),
  check('body').optional({ nullable: true }).isString().trim().isLength({ max: 5000 }),
  validatorMiddleware,
];
