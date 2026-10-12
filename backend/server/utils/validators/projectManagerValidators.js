const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// Fast request checks for /project-managers. Uniqueness (name case-insensitively, email) is decided
// by services/project/projectManagerService.js and backed by the model's unique indexes.

const idParam = check('id').isMongoId().withMessage('Invalid project manager id');

// Functions, not shared chains: express-validator chains are mutable, so `.optional()` on a shared
// instance would also make the name optional on create.
const nameRule = ({ optional = false } = {}) =>
  (optional ? check('name').optional() : check('name'))
    .isString()
    .withMessage('Project manager name must be text')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Project manager name is required')
    .isLength({ max: 100 })
    .withMessage('Project manager name cannot exceed 100 characters');

const emailRule = () =>
  check('email')
    .optional({ checkFalsy: true })
    .isString()
    .bail()
    .trim()
    .isEmail()
    .withMessage('Invalid email address')
    .isLength({ max: 254 });

const phoneRule = () =>
  check('phone')
    .optional({ checkFalsy: true })
    .isString()
    .bail()
    .trim()
    .matches(/^\+?[0-9 ()-]{5,30}$/)
    .withMessage('Invalid phone number');

const isActiveRule = () => check('isActive').optional().isBoolean({ strict: true }).withMessage('isActive must be true or false');

exports.getProjectManagerValidator = [idParam, validatorMiddleware];
exports.createProjectManagerValidator = [nameRule(), emailRule(), phoneRule(), isActiveRule(), validatorMiddleware];
exports.updateProjectManagerValidator = [idParam, nameRule({ optional: true }), emailRule(), phoneRule(), isActiveRule(), validatorMiddleware];
exports.deleteProjectManagerValidator = [idParam, validatorMiddleware];
