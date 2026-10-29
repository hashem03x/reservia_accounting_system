const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { normalizeEgyptianPhone } = require('../../crm/phone');
const { SEGMENTS, CHANNELS, LOST_REASONS } = require('../../crm/constants');
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
  check('segment').optional({ nullable: true }).isIn(SEGMENTS).withMessage('Invalid segment'),
  check('governorate').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('source').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  check('partnerName').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  check('monthlyBillEgp').optional({ nullable: true }).isFloat({ min: 0 }),
  check('systemSizeKwp').optional({ nullable: true }).isFloat({ min: 0 }),
  check('valueEgp').optional({ nullable: true }).isFloat({ min: 0 }),
  check('owner').optional({ nullable: true }).isMongoId().withMessage('Invalid owner id'),
  validatorMiddleware,
];

exports.leadIdValidator = [check('id').isMongoId().withMessage('Invalid lead id'), validatorMiddleware];

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
  check('mdApproved').optional({ nullable: true }).isBoolean(),
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
