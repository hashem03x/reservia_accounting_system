const { check } = require('express-validator');
const validatorMiddleware = require('../../../middleware/validatorMiddleware');
const { isSafeMediaUrl } = require('../../website/sectionValidation');

// Website Management - PUT /website/settings. Lengths mirror websiteSettingsModel.js; these
// rules add what a schema can't say (a real https origin, a template with one %s, the default
// language being one of the enabled ones).

const LOCALES = ['ar', 'en'];
const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SAFE_HREF = /^(https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*|#[A-Za-z0-9_-]*|mailto:[^\s"'<>]+|tel:\+?[0-9 ()-]+)$/i;
const optionalText = (field, max) => check(field).optional({ nullable: false }).isString().withMessage(`${field} must be text`).bail().trim().isLength({ max }).withMessage(`${field} must be at most ${max} characters`);

const imageRef = field =>
  check(field)
    .optional({ nullable: true })
    .custom(v => {
      if (v === null) return true;
      if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${field} is invalid`);
      if (v.url != null && !isSafeMediaUrl(String(v.url))) throw new Error(`${field}.url must be an https URL`);
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
  imageRef('logoDark'),
  imageRef('favicon'),
  optionalText('descriptionEn', 600),
  optionalText('descriptionAr', 600),
  optionalText('businessHoursNoteEn', 200),
  optionalText('businessHoursNoteAr', 200),
  check('businessHours')
    .optional()
    .isArray({ max: 7 })
    .withMessage('Business hours are one row per day (at most 7)')
    .bail()
    .custom(rows => {
      const days = new Set();
      for (const r of rows) {
        if (!r || typeof r !== 'object' || !DAYS.includes(r.day)) throw new Error('Each business-hours row needs a day (sat, sun, mon, tue, wed, thu, fri)');
        if (days.has(r.day)) throw new Error('A day is listed twice in business hours');
        days.add(r.day);
        if (r.closed) continue;
        if (!TIME.test(String(r.open || '')) || !TIME.test(String(r.close || ''))) throw new Error('Opening and closing times must be HH:MM (24-hour)');
        if (String(r.open) >= String(r.close)) throw new Error('A closing time must be after the opening time');
      }
      return true;
    }),
  check('header').optional({ nullable: true }).isObject().withMessage('header is invalid'),
  check('header.ctaHref').optional().isString().custom(v => {
    if (v && !SAFE_HREF.test(v)) throw new Error('The header button link must be https://..., /path, #anchor, mailto: or tel:');
    return true;
  }),
  optionalText('header.ctaLabelEn', 40),
  optionalText('header.ctaLabelAr', 40),
  check('header.showCta').optional().isBoolean(),
  check('header.showPhone').optional().isBoolean(),
  check('header.sticky').optional().isBoolean(),
  check('footer').optional({ nullable: true }).isObject().withMessage('footer is invalid'),
  check('footer.showSocial').optional().isBoolean(),
  check('footer.showContact').optional().isBoolean(),
  check('footer.showNewsletter').optional().isBoolean(),
  check('cookieConsent').optional({ nullable: true }).isObject().withMessage('cookieConsent is invalid'),
  check('cookieConsent.enabled').optional().isBoolean(),
  check('cookieConsent.blockTrackingUntilConsent').optional().isBoolean(),
  optionalText('cookieConsent.messageEn', 400),
  optionalText('cookieConsent.messageAr', 400),
  optionalText('cookieConsent.acceptLabelEn', 30),
  optionalText('cookieConsent.acceptLabelAr', 30),
  check('cookieConsent.policyUrl').optional().isString().custom(v => {
    if (v && !SAFE_HREF.test(v)) throw new Error('The privacy policy link must be https://... or a site path such as /privacy');
    return true;
  }),
  check('cookieConsent').custom(v => {
    if (v && v.enabled && !(v.messageEn || v.messageAr)) throw new Error('Enter the cookie notice text before enabling it');
    return true;
  }),
  check('robots').optional({ nullable: true }).isObject().withMessage('robots is invalid'),
  check('robots.discourageIndexing').optional().isBoolean(),
  check('robots.disallowPaths')
    .optional()
    .isArray({ max: 50 })
    .bail()
    .custom(list => {
      for (const p of list) if (typeof p !== 'string' || !/^\/[A-Za-z0-9_\-./*?=&%]*$/.test(p)) throw new Error(`"${p}" is not a valid path to block (it must start with /)`);
      return true;
    }),
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
