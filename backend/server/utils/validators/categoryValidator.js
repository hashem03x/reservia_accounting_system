const { check, body } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

exports.getCategoryValidator = [check('id').isMongoId().withMessage('Invalid category id format'), validatorMiddleware];

exports.createCategoryValidator = [
  check('name').custom(value => {
    if (!value.en || !value.ar) throw new Error('invalid_input');
    return true;
  }),
  validatorMiddleware,
];

exports.getCategoryValidator = [check('id').isMongoId().withMessage('Invalid category id format'), validatorMiddleware];

exports.updateCategoryValidator = [
  check('id').isMongoId().withMessage('Invalid category id format'),
  body('name')
    .optional()
    .custom(value => {
      if (!value.en || !value.ar) throw new Error('invalid_input');
      return true;
    }),
  validatorMiddleware,
];

exports.deleteCategoryValidator = [check('id').isMongoId().withMessage('Invalid category id format'), validatorMiddleware];
