const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { SECTION_TYPES } = require('../../website/sectionTypes');

const createSectionValidators = [
  check('type').notEmpty().withMessage('Section type is required').isIn(SECTION_TYPES).withMessage(`Section type must be one of: ${SECTION_TYPES.join(', ')}`),
  check('content').optional().custom(value => value == null || (typeof value === 'object' && !Array.isArray(value))).withMessage('Section content must be an object'),
  check('isVisible').optional().isBoolean(),
  validatorMiddleware,
];

const updateSectionValidators = [
  check('content').optional().custom(value => value == null || (typeof value === 'object' && !Array.isArray(value))).withMessage('Section content must be an object'),
  check('isVisible').optional().isBoolean(),
  validatorMiddleware,
];

const reorderSectionsValidators = [
  check('order').isArray({ min: 1 }).withMessage('An array of section ids is required'),
  check('order.*').isMongoId().withMessage('Invalid section id in the order list'),
  validatorMiddleware,
];

module.exports = { createSectionValidators, updateSectionValidators, reorderSectionsValidators };
