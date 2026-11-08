const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');

const uploadMediaValidators = [
  check('folder').optional().isString().trim().isLength({ max: 40 }),
  check('altEn').optional().isString().trim().isLength({ max: 200 }),
  check('altAr').optional().isString().trim().isLength({ max: 200 }),
  validatorMiddleware,
];

const updateMediaValidators = [
  check('altEn').optional().isString().trim().isLength({ max: 200 }),
  check('altAr').optional().isString().trim().isLength({ max: 200 }),
  check('folder').optional().isString().trim().isLength({ max: 40 }),
  validatorMiddleware,
];

module.exports = { uploadMediaValidators, updateMediaValidators };
