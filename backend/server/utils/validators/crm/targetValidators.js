const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { TARGET_SEGMENTS } = require('../../crm/constants');

exports.setTargetValidator = [
  check('segment').isIn(TARGET_SEGMENTS).withMessage('Invalid segment'),
  check('year').isInt({ min: 2020, max: 2100 }).withMessage('Invalid year'),
  check('month').isInt({ min: 1, max: 12 }).withMessage('Invalid month'),
  check('targetValueEgp').optional({ nullable: true }).isFloat({ min: 0 }),
  check('targetDealCount').optional({ nullable: true }).isInt({ min: 0 }),
  check('targetEnquiries').optional({ nullable: true }).isInt({ min: 0 }),
  check('targetQualified').optional({ nullable: true }).isInt({ min: 0 }),
  check('targetSurveys').optional({ nullable: true }).isInt({ min: 0 }),
  check('targetProposals').optional({ nullable: true }).isInt({ min: 0 }),
  check('targetSigned').optional({ nullable: true }).isInt({ min: 0 }),
  validatorMiddleware,
];

exports.listTargetsValidator = [
  check('year').isInt({ min: 2020, max: 2100 }).withMessage('Invalid year'),
  check('month').isInt({ min: 1, max: 12 }).withMessage('Invalid month'),
  check('segment').optional({ nullable: true }).isIn(TARGET_SEGMENTS).withMessage('Invalid segment'),
  validatorMiddleware,
];
