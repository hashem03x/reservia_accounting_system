const { check, body } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');

exports.createBrandValidator = [
  check('name')
    .notEmpty()
    .withMessage('Brand name is required')
    .isLength({ min: 3 })
    .withMessage('Brand name is too short')
    .isLength({ max: 32 })
    .withMessage('Brand name is too long'),
  validatorMiddleware,
];

exports.getBrandValidator = [
  check('id').notEmpty().withMessage('Brand id is required').isMongoId().withMessage('Invalid brnad id format '),
  validatorMiddleware,
];

exports.updateBrandValidator = [
  check('id').notEmpty().withMessage('Brand id is required').isMongoId().withMessage('Invalid brnad id format '),
  body('name').optional(),
  validatorMiddleware,
];

exports.deleteBrandValidator = [
  check('id').notEmpty().withMessage('Brand id is required').isMongoId().withMessage('Invalid brnad id format '),
  validatorMiddleware,
];
