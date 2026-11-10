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

// Text SEO fields and their limits - mirrors websitePageModel.js#seo exactly.
const SEO_TEXT_LIMITS = {
  titleEn: 70,
  titleAr: 70,
  descriptionEn: 160,
  descriptionAr: 160,
  canonicalEn: 500,
  canonicalAr: 500,
  ogTitleEn: 95,
  ogTitleAr: 95,
  ogDescriptionEn: 200,
  ogDescriptionAr: 200,
  breadcrumbLabelEn: 60,
  breadcrumbLabelAr: 60,
};
const SEO_BOOLEANS = ['noindex', 'nofollow', 'showBreadcrumbs'];
const SEO_KEYS = new Set([...Object.keys(SEO_TEXT_LIMITS), ...SEO_BOOLEANS, 'ogImage', 'twitterCard']);
// Matches seoResolver.js#NON_PUBLIC_PATH: staff/system areas are never a page path or canonical.
const NON_PUBLIC_PATH = /^\/(admin|dashboard|api|website|portal|crm|commercial|login)(\/|$)/i;

const seoRule = check('seo').optional().custom(value => {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid SEO object');
  for (const key of Object.keys(value)) {
    if (!SEO_KEYS.has(key)) throw new Error(`seo.${key} is not a known SEO field`);
  }
  for (const [key, max] of Object.entries(SEO_TEXT_LIMITS)) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') throw new Error(`seo.${key} must be text`);
    if (value[key].trim().length > max) throw new Error(`seo.${key} must be at most ${max} characters`);
  }
  for (const key of SEO_BOOLEANS) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`seo.${key} must be true or false`);
  }
  if (value.twitterCard !== undefined && !['', 'summary', 'summary_large_image'].includes(value.twitterCard)) {
    throw new Error('seo.twitterCard must be summary or summary_large_image');
  }
  for (const key of ['canonicalEn', 'canonicalAr']) {
    const v = typeof value[key] === 'string' ? value[key].trim() : '';
    if (!v) continue;
    // Absolute https URL, or a site path ("/services"); nothing else, never a staff area.
    const ok = /^https:\/\/[^/\s]+\.[^/\s]+(\/\S*)?$/i.test(v) || (/^\/[^\s/][^\s]*$|^\/$/.test(v) && !NON_PUBLIC_PATH.test(v));
    if (!ok) throw new Error(`seo.${key} must be an https URL or a site path starting with /`);
  }
  if (value.ogImage !== undefined && value.ogImage !== null) {
    const img = value.ogImage;
    if (typeof img !== 'object' || Array.isArray(img)) throw new Error('seo.ogImage is invalid');
    if (img.url != null && !/^https:\/\//i.test(String(img.url))) throw new Error('seo.ogImage.url must be an https URL');
  }
  return true;
});

// A page path is language-agnostic ("/about"; the website adds /ar or /en itself), lowercase.
const pathRule = (field, { required }) => {
  const chain = required ? check(field).notEmpty().withMessage('Path is required') : check(field).optional();
  return chain
    .bail()
    .isString()
    .trim()
    .custom(v => {
      const p = v.length > 1 ? v.replace(/\/+$/, '') : v;
      if (!/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/.test(p)) throw new Error('Path must start with / and use only lowercase letters, numbers, hyphens and /');
      if (/^\/(ar|en)(\/|$)/.test(p)) throw new Error('Leave out the language: use /about, not /ar/about - the language is added automatically');
      if (NON_PUBLIC_PATH.test(p)) throw new Error('This path is reserved for staff areas and cannot be a website page');
      return true;
    });
};

const localesRule = check('locales')
  .optional()
  .isArray({ min: 1 })
  .withMessage('A page needs at least one language')
  .bail()
  .custom(v => {
    if (!v.every(l => l === 'ar' || l === 'en')) throw new Error('Languages must be ar or en');
    if (new Set(v).size !== v.length) throw new Error('A language is listed twice');
    return true;
  });

const createPageValidators = [
  slugRule('slug', { required: true }),
  pathRule('path', { required: true }),
  check('isHomePage').optional().isBoolean(),
  check('pageType').optional().isIn(['managed', 'legacy']),
  check('parentSlug').optional({ nullable: true }).isString().trim(),
  check('sortOrder').optional().isInt(),
  localesRule,
  seoRule,
  validatorMiddleware,
];

const updatePageValidators = [
  pathRule('path', { required: false }),
  check('isHomePage').optional().isBoolean(),
  check('pageType').optional().isIn(['managed', 'legacy']),
  check('parentSlug').optional({ nullable: true }).isString().trim(),
  check('sortOrder').optional().isInt(),
  localesRule,
  seoRule,
  validatorMiddleware,
];

const duplicatePageValidators = [slugRule('slug', { required: true }), pathRule('path', { required: true }), validatorMiddleware];

const publishPageValidators = [check('label').optional().isString().trim().isLength({ max: 200 }), validatorMiddleware];

// The live preview takes the same (unsaved) fields as an update, validated the same way.
const previewPageSeoValidators = updatePageValidators;

module.exports = { createPageValidators, updatePageValidators, duplicatePageValidators, publishPageValidators, previewPageSeoValidators, SEO_TEXT_LIMITS };
