const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// Fast request checks for /sectors. Name uniqueness (case-insensitive) is decided by
// services/project/sectorService.js and backed by the model's unique index.

const idParam = check('id').isMongoId().withMessage('Invalid sector id');

// A function, not a shared chain: express-validator chains are mutable, so `.optional()` on a
// shared instance would also make the name optional on create.
const nameRule = ({ optional = false } = {}) => {
  const chain = optional ? check('name').optional() : check('name');
  return chain
    .isString()
    .withMessage('Sector name must be text')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Sector name is required')
    .isLength({ max: 100 })
    .withMessage('Sector name cannot exceed 100 characters');
};

const isActiveRule = check('isActive').optional().isBoolean({ strict: true }).withMessage('isActive must be true or false');

exports.getSectorValidator = [idParam, validatorMiddleware];

exports.createSectorValidator = [nameRule(), isActiveRule, validatorMiddleware];

exports.updateSectorValidator = [idParam, nameRule({ optional: true }), isActiveRule, validatorMiddleware];

exports.deleteSectorValidator = [idParam, validatorMiddleware];
