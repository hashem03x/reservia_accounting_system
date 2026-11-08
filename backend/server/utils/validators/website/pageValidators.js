const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');

const slugRule = (field, { required }) => {
  const chain = required ? check(field).notEmpty().withMessage('Slug is required') : check(field).optional();
  return chain
    .bail()
    .isString()
    .trim()
    .toLowerCase()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug may only contain lowercase letters, numbers and hyphens');
};

const seoRule = check('seo').optional().custom(value => {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid SEO object');
  const strings = ['titleEn', 'titleAr', 'descriptionEn', 'descriptionAr'];
  for (const key of strings) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`seo.${key} must be text`);
  }
  if (value.noindex !== undefined && typeof value.noindex !== 'boolean') throw new Error('seo.noindex must be true or false');
  return true;
});

const createPageValidators = [
  slugRule('slug', { required: true }),
  check('path').notEmpty().withMessage('Path is required').isString().trim(),
  check('isHomePage').optional().isBoolean(),
  check('pageType').optional().isIn(['managed', 'legacy']),
  check('parentSlug').optional({ nullable: true }).isString().trim(),
  check('sortOrder').optional().isInt(),
  seoRule,
  validatorMiddleware,
];

const updatePageValidators = [
  check('path').optional().isString().trim(),
  check('isHomePage').optional().isBoolean(),
  check('pageType').optional().isIn(['managed', 'legacy']),
  check('parentSlug').optional({ nullable: true }).isString().trim(),
  check('sortOrder').optional().isInt(),
  seoRule,
  validatorMiddleware,
];

const duplicatePageValidators = [slugRule('slug', { required: true }), check('path').notEmpty().withMessage('Path is required').isString().trim(), validatorMiddleware];

const publishPageValidators = [check('label').optional().isString().trim().isLength({ max: 200 }), validatorMiddleware];

module.exports = { createPageValidators, updatePageValidators, duplicatePageValidators, publishPageValidators };
