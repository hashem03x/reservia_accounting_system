const { check } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');

exports.loginValidator = [
  check('email').notEmpty().withMessage('User email is required').isEmail().withMessage('invalid email address'),
  check('password').notEmpty().withMessage('password required').isLength({ min: 6 }).withMessage('password must be at least 6 charachters'),
  validatorMiddleware,
];
