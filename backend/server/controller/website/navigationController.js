const asyncHandler = require('express-async-handler');
const WebsiteNavigation = require('../../models/website/websiteNavigationModel');
const WebsitePage = require('../../models/website/websitePageModel');
const apiResponse = require('../../utils/apiResponse');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { normalizeNavigation, navigationWarnings } = require('../../utils/website/navigation');

// Website Management - header & footer navigation (a singleton, websiteNavigationModel.js).
// Reading is open to every Website role; changing the site structure needs `navigation.manage`
// (administrators). Saved menus reach the live site on the next build (Publish or "Update live
// website"); only links to published pages are ever rendered there (utils/website/navigation.js).

async function load() {
  const doc = await WebsiteNavigation.findById(WebsiteNavigation.SINGLETON_ID).lean();
  return doc || { _id: WebsiteNavigation.SINGLETON_ID, headerEntries: [], footerColumns: [] };
}

async function pagesBySlug() {
  const pages = await WebsitePage.find({ isActive: true }).select('slug path status titleEn titleAr').lean();
  return new Map(pages.map(p => [p.slug, p]));
}

const getNavigation = asyncHandler(async (req, res) => {
  const [nav, pages] = await Promise.all([load(), pagesBySlug()]);
  res.status(200).json(apiResponse('Navigation retrieved', true, { ...nav, warnings: navigationWarnings(nav, pages) }));
});

const updateNavigation = asyncHandler(async (req, res) => {
  const pages = await pagesBySlug();
  const clean = normalizeNavigation(req.body || {}, { knownSlugs: new Set(pages.keys()) });
  let doc = await WebsiteNavigation.findById(WebsiteNavigation.SINGLETON_ID);
  if (!doc) doc = new WebsiteNavigation({ _id: WebsiteNavigation.SINGLETON_ID });
  const before = doc.toObject();
  if (clean.headerEntries) doc.headerEntries = clean.headerEntries;
  if (clean.footerColumns) doc.footerColumns = clean.footerColumns;
  doc.markModified('headerEntries');
  doc.markModified('footerColumns');
  doc.updatedBy = req.user._id;
  await doc.save();
  const saved = doc.toObject();
  await logWebsiteActivity({ actor: req.user, action: 'navigation.update', targetType: 'WebsiteNavigation', targetLabel: 'Navigation', before, after: saved });
  res.status(200).json(apiResponse('Navigation saved. It reaches the live website on the next update.', true, { ...saved, warnings: navigationWarnings(saved, pages) }));
});

module.exports = { getNavigation, updateNavigation };
