const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

exports.getGovernorateValidator = [check('id').isMongoId().withMessage('Invalid governorate id format'), validatorMiddleware];

exports.createGovernorateValidator = [
  check('name').custom(value => {
    if (!value.en || !value.ar) throw new Error('invalid_input');
    return true;
  }),
  check('cities').optional().isArray().withMessage('Cities must be an array'),
  check('shippingCost').isNumeric().withMessage('Invalid shipping cost'),
  validatorMiddleware,
];

exports.updateGovernorateValidator = [
  check('id').isMongoId().withMessage('Invalid governorate id format'),
  check('name')
    .optional()
    .custom(value => {
      if (!value.en || !value.ar) throw new Error('invalid_input');
      return true;
    }),
  check('cities').optional().isArray().withMessage('Cities must be an array'),
  check('shippingCost').optional().isNumeric().withMessage('Invalid shipping cost'),
  validatorMiddleware,
];
