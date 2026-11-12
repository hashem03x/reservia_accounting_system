const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const WebsiteRevision = require('../../models/website/websiteRevisionModel');
const WebsiteSettings = require('../../models/website/websiteSettingsModel');

// Website Management - reads the data seoResolver.js works on. Two views of the site:
//   - PUBLISHED: what is live. Every page's seo/sections/locales come from its publishedRevision's
//     frozen snapshot, never from the editable page/section documents, so a draft edit can never
//     leak into the public feed before an explicit Publish.
//   - DRAFT: what the editor is working on (the SEO audit and preview only - never public).

/** Site settings as a plain object; schema defaults when the singleton was never saved. */
async function loadSettings() {
  const doc = await WebsiteSettings.findById(WebsiteSettings.SINGLETON_ID).lean();
  return doc || new WebsiteSettings().toObject();
}

// `settings` = presentation (devices/background/spacing/alignment/anchor) - see sectionTypes.js.
const sectionForOutput = s => ({ type: s.type, sortOrder: s.sortOrder, content: s.content || {}, settings: s.settings || {} });
const visibleSorted = sections =>
  (Array.isArray(sections) ? sections : [])
    .filter(s => s && s.isVisible !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

/** Every live page with its published snapshot. Pages whose revision is missing are skipped. */
async function loadPublishedPages() {
  const pages = await WebsitePage.find({ isActive: true, status: 'published', publishedRevision: { $ne: null } })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  if (!pages.length) return [];
  const revisions = await WebsiteRevision.find({ _id: { $in: pages.map(p => p.publishedRevision) } }).lean();
  const byId = new Map(revisions.map(r => [String(r._id), r]));

  const out = [];
  for (const p of pages) {
    const rev = byId.get(String(p.publishedRevision));
    if (!rev) continue;
    const snap = rev.snapshot || {};
    out.push({
      _id: p._id,
      slug: p.slug,
      path: p.path,
      pageType: p.pageType,
      isHomePage: p.isHomePage,
      parentSlug: p.parentSlug,
      sortOrder: p.sortOrder,
      status: p.status,
      titleEn: snap.titleEn !== undefined ? snap.titleEn : p.titleEn || '',
      titleAr: snap.titleAr !== undefined ? snap.titleAr : p.titleAr || '',
      layout: snap.layout || p.layout || 'default',
      locales: Array.isArray(snap.locales) && snap.locales.length ? snap.locales : p.locales,
      seo: snap.seo || {},
      sections: visibleSorted(snap.sections).map(sectionForOutput),
      publishedAt: rev.publishedAt,
    });
  }
  return out;
}

/** Every active page as it stands in the editor (draft seo/locales + current visible sections). */
async function loadDraftPages() {
  const pages = await WebsitePage.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  if (!pages.length) return [];
  const sections = await WebsiteSection.find({ page: { $in: pages.map(p => p._id) } }).lean();
  const byPage = new Map();
  for (const s of sections) {
    const key = String(s.page);
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(s);
  }
  return pages.map(p => ({ ...p, sections: visibleSorted(byPage.get(String(p._id))).map(sectionForOutput) }));
}

module.exports = { loadSettings, loadPublishedPages, loadDraftPages };
