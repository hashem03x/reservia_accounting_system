const asyncHandler = require('express-async-handler');
const WebsiteSettings = require('../../models/website/websiteSettingsModel');
const apiResponse = require('../../utils/apiResponse');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { loadSettings } = require('../../services/website/publishedSite');

// Website Management - site-wide settings (a singleton - websiteSettingsModel.js). Editing them
// changes nothing on the live site by itself: like page edits, they reach the website on its next
// build (any Publish triggers one).

// Only these top-level keys can be written; nested objects are merged key by key so a request
// that changes one organization field never clears the others.
const SCALAR_KEYS = [
  'siteNameEn', 'siteNameAr', 'taglineEn', 'taglineAr', 'footerCopyrightEn', 'footerCopyrightAr', 'publishOrgContacts',
  'publicSiteUrl', 'defaultLocale', 'enabledLocales', 'titleTemplateEn', 'titleTemplateAr',
  'defaultDescriptionEn', 'defaultDescriptionAr', 'twitterHandle',
  'descriptionEn', 'descriptionAr', 'businessHours', 'businessHoursNoteEn', 'businessHoursNoteAr',
];
const OBJECT_KEYS = ['logo', 'logoDark', 'favicon', 'defaultOgImage', 'contact', 'socialLinks', 'organization', 'header', 'footer', 'cookieConsent', 'robots'];

const getSettings = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Website settings retrieved', true, await loadSettings()));
});

const updateSettings = asyncHandler(async (req, res) => {
  const body = req.body || {};
  let doc = await WebsiteSettings.findById(WebsiteSettings.SINGLETON_ID);
  if (!doc) doc = new WebsiteSettings({ _id: WebsiteSettings.SINGLETON_ID });
  const before = doc.toObject();

  for (const key of SCALAR_KEYS) if (body[key] !== undefined) doc[key] = body[key];
  for (const key of OBJECT_KEYS) {
    if (body[key] === undefined) continue;
    if (body[key] === null) {
      doc[key] = undefined; // back to schema defaults
      continue;
    }
    const current = doc[key] && typeof doc[key].toObject === 'function' ? doc[key].toObject() : doc[key] || {};
    doc[key] = { ...current, ...body[key] };
  }
  if (typeof body.publicSiteUrl === 'string') doc.publicSiteUrl = body.publicSiteUrl.trim().replace(/\/+$/, '');
  if (typeof body.twitterHandle === 'string') doc.twitterHandle = body.twitterHandle.trim().replace(/^@/, '');
  doc.updatedBy = req.user._id;
  await doc.save();

  await logWebsiteActivity({ actor: req.user, action: 'settings.update', targetType: 'WebsiteSettings', targetId: null, targetLabel: 'Website settings', before, after: doc.toObject() });
  res.status(200).json(apiResponse('Website settings saved', true, doc.toObject()));
});

module.exports = { getSettings, updateSettings };
