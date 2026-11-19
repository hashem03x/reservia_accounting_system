const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { isSafeMediaUrl } = require('../../website/sectionValidation');
const { slugRule, seoRule } = require('./pageValidators');

// Website Management - blog post validators. Reuses slugRule/seoRule from pageValidators.js as-is
// (generic over any `seo` sub-object, not page-specific) rather than duplicating them.

const localesRule = check('locales')
  .optional()
  .isArray({ min: 1 })
  .withMessage('A blog post needs at least one language')
  .bail()
  .custom(v => {
    if (!v.every(l => l === 'ar' || l === 'en')) throw new Error('Languages must be ar or en');
    if (new Set(v).size !== v.length) throw new Error('A language is listed twice');
    return true;
  });

const tagsRule = check('tags')
  .optional()
  .isArray({ max: 10 })
  .withMessage('At most 10 tags')
  .bail()
  .custom(v => {
    if (!v.every(t => typeof t === 'string' && t.trim().length <= 40)) throw new Error('Each tag must be text of at most 40 characters');
    return true;
  });

const authorRule = check('author')
  .optional()
  .custom(value => {
    if (value == null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid author object');
    for (const key of ['nameEn', 'nameAr']) {
      if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim().length > 80)) throw new Error(`author.${key} must be text of at most 80 characters`);
    }
    if (value.avatarUrl !== undefined && value.avatarUrl !== null && !isSafeMediaUrl(String(value.avatarUrl))) throw new Error('author.avatarUrl must be an https URL');
    return true;
  });

const featuredImageRule = check('featuredImage')
  .optional()
  .custom(value => {
    if (value == null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid featuredImage object');
    if (value.url != null && !isSafeMediaUrl(String(value.url))) throw new Error('featuredImage.url must be an https URL');
    for (const key of ['altEn', 'altAr']) {
      if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim().length > 160)) throw new Error(`featuredImage.${key} must be text of at most 160 characters`);
    }
    return true;
  });

const sharedFields = [
  check('titleEn').optional().isString().trim().isLength({ max: 150 }).withMessage('Title (English) must be at most 150 characters'),
  check('titleAr').optional().isString().trim().isLength({ max: 150 }).withMessage('Title (Arabic) must be at most 150 characters'),
  check('excerptEn').optional().isString().trim().isLength({ max: 300 }).withMessage('Excerpt (English) must be at most 300 characters'),
  check('excerptAr').optional().isString().trim().isLength({ max: 300 }).withMessage('Excerpt (Arabic) must be at most 300 characters'),
  // Not sanitized here - sanitization (allowlist-based, the real defense) runs in the controller on
  // save, exactly like seo.ogImage is validated-but-not-transformed at this layer and transformed
  // at the controller/model layer elsewhere in this codebase. This rule only bounds the raw size.
  check('bodyEn').optional().isString().isLength({ max: 200000 }).withMessage('Body (English) is too long'),
  check('bodyAr').optional().isString().isLength({ max: 200000 }).withMessage('Body (Arabic) is too long'),
  check('category').optional().isString().trim().isLength({ max: 60 }).withMessage('Category must be at most 60 characters'),
  tagsRule,
  authorRule,
  featuredImageRule,
  check('showRecentSidebar').optional().isBoolean(),
  localesRule,
  seoRule,
];

const createBlogPostValidators = [slugRule('slug', { required: true }), ...sharedFields, validatorMiddleware];

const updateBlogPostValidators = [slugRule('slug', { required: false }), ...sharedFields, validatorMiddleware];

const publishBlogPostValidators = [check('label').optional().isString().trim().isLength({ max: 200 }), validatorMiddleware];

// The live preview takes the same (unsaved) fields as an update, validated the same way.
const previewBlogPostSeoValidators = updateBlogPostValidators;

module.exports = { createBlogPostValidators, updateBlogPostValidators, publishBlogPostValidators, previewBlogPostSeoValidators };
