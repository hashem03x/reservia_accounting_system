const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { normalizeEgyptianPhone } = require('../../crm/phone');
const { FORM_SEGMENTS, CHANNELS, LOST_REASONS, SOURCES, GOVERNORATE_NAMES_EN } = require('../../crm/constants');
const { STAGES } = require('../../crm/stageRules');

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
  check('followUpAt').optional({ nullable: true }).isISO8601().withMessage('Invalid follow-up date'),
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
  check('type').notEmpty().withMessage('Activity type is required').isIn(['note', 'call', 'email', 'survey', 'proposal']).withMessage('Invalid activity type'),
  check('body').optional({ nullable: true }).isString().trim().isLength({ max: 5000 }),
  validatorMiddleware,
];
