const { check } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');

exports.createSubCategoryValidator = [
  check('name').custom(value => {
    if (!value.en || !value.ar) throw new Error('invalid_input');
    return true;
  }),
  check('mainCategory')
    .notEmpty()
    .withMessage('SubCategory must belong to main category')
    .isMongoId()
    .withMessage('Invalid category id format'),
  validatorMiddleware,
];

exports.getSubCategoryValidator = [check('id').isMongoId().withMessage('Invalid SubCategory id format'), validatorMiddleware];

exports.updateSubCategoryValidator = [
  check('id').isMongoId().withMessage('Invalid SubCategory id format'),
  check('name')
    .optional()
    .custom(value => {
      if (!value.en || !value.ar) throw new Error('invalid_input');
      return true;
    }),
  validatorMiddleware,
];

exports.deleteSubCategoryValidator = [check('id').isMongoId().withMessage('Invalid SubCategory id format'), validatorMiddleware];
