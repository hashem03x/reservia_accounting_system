const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');

// Website Management - PUT /website/settings. Lengths mirror websiteSettingsModel.js; these
// rules add what a schema can't say (a real https origin, a template with one %s, the default
// language being one of the enabled ones).

const LOCALES = ['ar', 'en'];
const optionalText = (field, max) => check(field).optional({ nullable: false }).isString().withMessage(`${field} must be text`).bail().trim().isLength({ max }).withMessage(`${field} must be at most ${max} characters`);

const imageRef = field =>
  check(field)
    .optional({ nullable: true })
    .custom(v => {
      if (v === null) return true;
      if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${field} is invalid`);
      if (v.url != null && !/^https:\/\//i.test(String(v.url))) throw new Error(`${field}.url must be an https URL`);
      return true;
    });

const updateSettingsValidators = [
  optionalText('siteNameEn', 120),
  optionalText('siteNameAr', 120),
  optionalText('taglineEn', 200),
  optionalText('taglineAr', 200),
  optionalText('footerCopyrightEn', 200),
  optionalText('footerCopyrightAr', 200),
  check('publishOrgContacts').optional().isBoolean(),
  check('publicSiteUrl')
    .optional()
    .isString()
    .trim()
    .custom(v => {
      if (v === '') return true;
      let u;
      try {
        u = new URL(v);
      } catch {
        throw new Error('The public site address must be a full URL such as https://reservia-energy.com');
      }
      if (u.protocol !== 'https:') throw new Error('The public site address must use https');
      if (!u.hostname.includes('.')) throw new Error('The public site address must be a real domain');
      if ((u.pathname && u.pathname !== '/') || u.search || u.hash) throw new Error('The public site address must be the domain only, with no path');
      return true;
    }),
  check('defaultLocale').optional().isIn(LOCALES).withMessage('The default language must be ar or en'),
  check('enabledLocales')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one language must be enabled')
    .bail()
    .custom(v => {
      if (!v.every(l => LOCALES.includes(l))) throw new Error('Languages must be ar or en');
      if (new Set(v).size !== v.length) throw new Error('A language is listed twice');
      return true;
    }),
  check('enabledLocales').custom((v, { req }) => {
    // The default language must itself be enabled - checked whenever either value is sent.
    const enabled = req.body.enabledLocales;
    const def = req.body.defaultLocale;
    if (Array.isArray(enabled) && def && !enabled.includes(def)) throw new Error('The default language must be one of the enabled languages');
    return true;
  }),
  ...['titleTemplateEn', 'titleTemplateAr'].map(f =>
    optionalText(f, 80).custom(v => {
      if (v === '') return true;
      const n = (v.match(/%s/g) || []).length;
      if (n !== 1) throw new Error('A title template must contain %s exactly once (where the page title goes)');
      return true;
    }),
  ),
  optionalText('defaultDescriptionEn', 160),
  optionalText('defaultDescriptionAr', 160),
  optionalText('twitterHandle', 30).matches(/^@?[A-Za-z0-9_]{0,15}$/).withMessage('The X (Twitter) handle may contain only letters, numbers and _'),
  imageRef('logo'),
  imageRef('defaultOgImage'),
  check('contact').optional({ nullable: true }).isObject().withMessage('contact is invalid'),
  check('socialLinks')
    .optional({ nullable: true })
    .isObject()
    .withMessage('socialLinks is invalid')
    .bail()
    .custom(v => {
      for (const [k, url] of Object.entries(v || {})) if (url && !/^https:\/\//i.test(String(url))) throw new Error(`The ${k} link must be an https URL`);
      return true;
    }),
  check('organization').optional({ nullable: true }).isObject().withMessage('organization is invalid'),
  check('organization.schemaType').optional().isIn(['Organization', 'LocalBusiness', 'ProfessionalService', 'HomeAndConstructionBusiness']),
  check('organization.foundingDate').optional().isString().matches(/^(\d{4}(-\d{2}(-\d{2})?)?)?$/).withMessage('Founding date must be YYYY, YYYY-MM or YYYY-MM-DD'),
  check('organization.addressCountry').optional().isString().matches(/^([A-Z]{2})?$/).withMessage('Country must be a two-letter code such as EG'),
  validatorMiddleware,
];

module.exports = { updateSettingsValidators };
