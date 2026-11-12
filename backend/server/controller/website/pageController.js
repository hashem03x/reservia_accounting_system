const asyncHandler = require('express-async-handler');
const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const WebsiteRevision = require('../../models/website/websiteRevisionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { triggerPublishDeploy, triggerPreviewDeploy, getPreviewUrl } = require('../../services/website/deployService');
const { loadSettings, loadPublishedPages, loadDraftPages } = require('../../services/website/publishedSite');
const { publishProblems, resolveDraft, resolveSite, normalizePath } = require('../../utils/website/seoResolver');
const WebsiteNavigation = require('../../models/website/websiteNavigationModel');
const publishing = require('../../services/website/publishingService');
const { createPreviewToken } = require('../../utils/website/previewToken');
const { validateSettings } = require('../../utils/website/sectionValidation');

/** What the dashboard shows as the page's status: draft / published / scheduled / archived. */
function displayStatus(page) {
  if (page.status === 'archived') return 'archived';
  if (page.scheduledPublishAt) return 'scheduled';
  if (page.status === 'published') return 'published';
  return 'draft';
}

/** Rewrites navigation links that point at a page slug (slug renamed). Returns how many changed. */
async function renameSlugInNavigation(oldSlug, newSlug) {
  const nav = await WebsiteNavigation.findById(WebsiteNavigation.SINGLETON_ID);
  if (!nav) return 0;
  let changed = 0;
  const walk = list =>
    (list || []).map(entry => {
      const e = { ...entry };
      if (e.pageSlug === oldSlug) {
        e.pageSlug = newSlug;
        changed += 1;
      }
      if (Array.isArray(e.items)) e.items = walk(e.items);
      return e;
    });
  nav.headerEntries = walk(nav.headerEntries);
  nav.footerColumns = walk(nav.footerColumns);
  if (changed) {
    nav.markModified('headerEntries');
    nav.markModified('footerColumns');
    await nav.save();
  }
  return changed;
}

// Website Management - Pages. Mirrors chartOfAccountController.js's CRUD conventions
// (asyncHandler, ApiError/apiResponse, duplicate-key translation, soft-deactivate instead of
// hard delete for anything another record can reference).

/**
 * Two active pages on the same path would serve the same URL with two different heads (and two
 * self-referencing canonicals) - refused. Returns an error message, or null when the path is free.
 */
async function pathConflict(path, exceptId) {
  if (path === undefined) return null;
  const filter = { isActive: true, path: normalizePath(path) };
  if (exceptId) filter._id = { $ne: exceptId };
  const other = await WebsitePage.findOne(filter).select('slug').lean();
  return other ? `The path ${normalizePath(path)} is already used by the page "${other.slug}".` : null;
}

const createPage = asyncHandler(async (req, res, next) => {
  try {
    const { slug, path, isHomePage, pageType, parentSlug, sortOrder, locales, seo, titleEn, titleAr, layout } = req.body;
    const conflict = await pathConflict(path);
    if (conflict) return next(new ApiError(conflict, 400));
    let order = sortOrder;
    if (order === undefined) {
      const last = await WebsitePage.findOne({ isActive: true }).sort({ sortOrder: -1 }).select('sortOrder').lean();
      order = (last?.sortOrder ?? -1) + 1;
    }
    const page = await WebsitePage.create({ slug, path: normalizePath(path), isHomePage, pageType, parentSlug, sortOrder: order, locales, seo, titleEn, titleAr, layout, createdBy: req.user._id });
    await logWebsiteActivity({ actor: req.user, action: 'page.create', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, after: page.toObject() });
    res.status(201).json(apiResponse('Page created successfully', true, page));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A page with this slug already exists.', 400));
    throw err;
  }
});

const escapeRegex = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, ch => `\\${ch}`);

// ?status=draft|published|scheduled|archived  ?q=<slug, path or title>
const getPages = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const { status, q } = req.query;
  if (status === 'archived') filter.status = 'archived';
  else if (status === 'scheduled') filter.scheduledPublishAt = { $ne: null };
  else if (status === 'published') Object.assign(filter, { status: 'published', scheduledPublishAt: null });
  else if (status === 'draft') Object.assign(filter, { status: { $in: ['never_published', 'unpublished'] }, scheduledPublishAt: null });
  else if (status !== 'all') filter.status = { $ne: 'archived' };
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 80)), 'i');
    filter.$or = [{ slug: rx }, { path: rx }, { titleEn: rx }, { titleAr: rx }, { 'seo.titleEn': rx }, { 'seo.titleAr': rx }];
  }
  ['status', 'q'].forEach(k => delete req.query[k]);
  const countDocuments = await WebsitePage.countDocuments(filter);
  const features = new ApiFeatures(WebsitePage.find(filter), req.query).paginate(countDocuments).limitFields();
  const pages = await features.mongooseQuery.sort({ sortOrder: 1, createdAt: 1 }).lean();
  const data = pages.map(page => ({ ...page, displayStatus: displayStatus(page) }));
  res.status(200).json({ results: data.length, paginationResult: features.paginationResult, data });
});

/** PATCH /pages/reorder { order: [pageId...] } - the order pages appear in the dashboard and default listings. */
const reorderPages = asyncHandler(async (req, res, next) => {
  const { order } = req.body || {};
  if (!Array.isArray(order) || !order.length) return next(new ApiError('An array of page ids in their new order is required.', 400));
  const found = await WebsitePage.countDocuments({ _id: { $in: order }, isActive: true });
  if (found !== order.length || new Set(order.map(String)).size !== order.length) return next(new ApiError('The order list contains an unknown or repeated page.', 400));
  await WebsitePage.bulkWrite(order.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: i, updatedBy: req.user._id } } } })));
  await logWebsiteActivity({ actor: req.user, action: 'page.reorder', targetType: 'WebsitePage', targetLabel: 'Page order', after: { order } });
  res.status(200).json(apiResponse('Pages reordered', true, { order }));
});

// Whether the page has draft changes not yet reflected in its publishedRevision - computed at
// read time, never persisted (plan doc section 1 - "never a persisted/driftable summary").
async function hasPendingChanges(page) {
  if (!page.publishedRevision) return true; // never published - always "pending" until the first publish
  const revision = await WebsiteRevision.findById(page.publishedRevision).lean();
  if (!revision) return true;
  if (new Date(page.updatedAt) > new Date(revision.publishedAt)) return true;
  const latestSectionUpdate = await WebsiteSection.findOne({ page: page._id }).sort({ updatedAt: -1 }).lean();
  return !!latestSectionUpdate && new Date(latestSectionUpdate.updatedAt) > new Date(revision.publishedAt);
}

const getPage = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));
  const pending = await hasPendingChanges(page);
  res.status(200).json(apiResponse('Page retrieved successfully', true, { ...page.toObject(), hasPendingChanges: pending, displayStatus: displayStatus(page) }));
});

const updatePage = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));

  try {
    const before = page.toObject();
    const { path, isHomePage, pageType, parentSlug, sortOrder, locales, seo, titleEn, titleAr, layout, slug } = req.body;
    const conflict = await pathConflict(path, page._id);
    if (conflict) return next(new ApiError(conflict, 400));
    if (parentSlug && parentSlug === page.slug) return next(new ApiError('A page cannot be its own parent.', 400));
    let renamedFrom = null;
    if (slug !== undefined && slug !== page.slug) {
      if (page.isHomePage) return next(new ApiError('The home page slug cannot be changed.', 400));
      if (await WebsitePage.exists({ slug, _id: { $ne: page._id } })) return next(new ApiError('A page with this slug already exists.', 400));
      renamedFrom = page.slug;
      page.slug = slug;
    }
    if (titleEn !== undefined) page.titleEn = titleEn;
    if (titleAr !== undefined) page.titleAr = titleAr;
    if (layout !== undefined) page.layout = layout;
    if (path !== undefined) page.path = normalizePath(path);
    if (isHomePage !== undefined) page.isHomePage = isHomePage;
    if (pageType !== undefined) page.pageType = pageType;
    if (parentSlug !== undefined) page.parentSlug = parentSlug || null;
    if (sortOrder !== undefined) page.sortOrder = sortOrder;
    if (locales !== undefined) page.locales = locales;
    // A partial merge: only the SEO fields the request names change; every other field the
    // editor set earlier is kept exactly as it was.
    if (seo !== undefined) page.seo = { ...page.seo.toObject(), ...seo };
    page.updatedBy = req.user._id;
    await page.save();

    // Navigation links follow a renamed slug, and child pages keep their parent.
    if (renamedFrom) {
      await renameSlugInNavigation(renamedFrom, page.slug);
      await WebsitePage.updateMany({ parentSlug: renamedFrom }, { $set: { parentSlug: page.slug } });
    }
    await logWebsiteActivity({ actor: req.user, action: 'page.update', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, before, after: page.toObject() });
    res.status(200).json(apiResponse('Page updated successfully', true, { ...page.toObject(), displayStatus: displayStatus(page) }));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A page with this slug already exists.', 400));
    throw err;
  }
});

// Duplicates a page AND its sections (a fresh, unpublished draft - never carries over the
// original's publish state/revision) - the task's own "duplicate" requirement.
const duplicatePage = asyncHandler(async (req, res, next) => {
  const original = await WebsitePage.findById(req.params.id);
  if (!original || !original.isActive) return next(new ApiError('No page found with that id', 404));
  const { slug, path } = req.body;
  if (!slug || !path) return next(new ApiError('A new slug and path are required to duplicate a page.', 400));
  const conflict = await pathConflict(path);
  if (conflict) return next(new ApiError(conflict, 400));

  try {
    const copy = await WebsitePage.create({
      slug,
      path: normalizePath(path),
      isHomePage: false,
      pageType: original.pageType,
      parentSlug: original.parentSlug,
      sortOrder: original.sortOrder,
      locales: original.locales,
      titleEn: original.titleEn ? `${original.titleEn} (copy)`.slice(0, 120) : '',
      titleAr: original.titleAr || '',
      layout: original.layout,
      // The copy's canonical must not point at the original's URL by accident: a canonical
      // override is cleared, everything else is copied for the editor to adjust.
      seo: { ...original.seo.toObject(), canonicalEn: '', canonicalAr: '' },
      createdBy: req.user._id,
    });
    const sections = await WebsiteSection.find({ page: original._id }).sort({ sortOrder: 1 }).lean();
    if (sections.length) {
      await WebsiteSection.insertMany(sections.map(s => ({ page: copy._id, type: s.type, sortOrder: s.sortOrder, isVisible: s.isVisible, content: s.content, settings: s.settings || {}, adminLabel: s.adminLabel || '', createdBy: req.user._id })));
    }

    await logWebsiteActivity({ actor: req.user, action: 'page.create', targetType: 'WebsitePage', targetId: copy._id, targetLabel: copy.slug, after: { duplicatedFrom: original.slug } });
    res.status(201).json(apiResponse('Page duplicated successfully', true, copy));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A page with this slug already exists.', 400));
    throw err;
  }
});

// Soft-deactivate - a page referenced by a WebsiteRevision/the live site must never disappear
// from under published history (mirrors chartOfAccountController.js#deactivateAccount exactly).
const deletePage = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page) return next(new ApiError('No page found with that id', 404));
  if (page.isHomePage) return next(new ApiError('The home page cannot be deleted.', 400));

  const wasLive = page.isActive && page.status === 'published';
  page.isActive = false;
  page.updatedBy = req.user._id;
  await page.save();
  await logWebsiteActivity({ actor: req.user, action: 'page.delete', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug });
  // A live page leaves the website (and its menus/sitemap) on the next build - start it now.
  const deploy = wasLive ? await triggerPublishDeploy() : null;
  res.status(200).json(apiResponse('Page deleted successfully', true, { ...page.toObject(), deploy }));
});

// Publish / unpublish / schedule / archive - services/website/publishingService.js (atomic: the
// revision and the page pointer are written in one transaction).
const publishPage = asyncHandler(async (req, res) => {
  const result = await publishing.publishNow(req.params.id, { user: req.user, label: req.body?.label });
  res.status(200).json(apiResponse('Page published successfully', true, result));
});

const unpublishPage = asyncHandler(async (req, res) => {
  const result = await publishing.unpublish(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Page unpublished successfully', true, result));
});

const schedulePage = asyncHandler(async (req, res) => {
  const result = await publishing.schedule(req.params.id, req.body?.publishAt, { user: req.user, label: req.body?.label });
  res.status(200).json(apiResponse('Publish scheduled - the current draft goes live at the chosen time.', true, result));
});

const cancelSchedule = asyncHandler(async (req, res) => {
  const page = await publishing.cancelSchedule(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Scheduled publish cancelled', true, page));
});

const archivePage = asyncHandler(async (req, res) => {
  const result = await publishing.archive(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Page archived - it is no longer on the website, its history is kept.', true, result));
});

const restorePage = asyncHandler(async (req, res) => {
  const result = await publishing.restoreFromArchive(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Page restored as a draft', true, result));
});

/** GET /pages/cron/scheduled - applies due scheduled publishes (Vercel Cron, Bearer CRON_SECRET). */
const runScheduledPublishes = asyncHandler(async (req, res, next) => {
  const expected = process.env.CRON_SECRET;
  const given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const ok = expected && given.length === expected.length && require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return next(new ApiError('Unauthorized.', 401));
  const result = await publishing.runDueSchedules();
  res.status(200).json(apiResponse(`${result.published.length} scheduled page(s) published`, true, result));
});

/** POST /pages/:id/preview-token - a 30-minute signed link that renders THIS page's draft on the real website. */
const createPagePreview = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id).lean();
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));
  const { token, expiresAt } = createPreviewToken(page._id, { userId: req.user._id });
  const settings = await loadSettings();
  const origin = (process.env.WEBSITE_PUBLIC_URL || settings.publicSiteUrl || '').replace(/\/+$/, '');
  const lang = req.body?.lang === 'en' ? 'en' : req.body?.lang === 'ar' ? 'ar' : (page.locales || ['ar'])[0];
  const previewUrl = origin ? `${origin}/${lang}/__preview?token=${encodeURIComponent(token)}` : null;
  await logWebsiteActivity({ actor: req.user, action: 'preview.create', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug });
  res.status(200).json(apiResponse(previewUrl ? 'Preview link created' : 'Preview token created - set the public website URL in Website Settings to open it.', true, { token, expiresAt, previewUrl }));
});

/** GET /pages/:id/revisions/:revisionId - one published version, with its full snapshot. */
const getPageRevision = asyncHandler(async (req, res, next) => {
  const revision = await WebsiteRevision.findOne({ _id: req.params.revisionId, page: req.params.id }).populate('publishedBy', 'name');
  if (!revision) return next(new ApiError('No revision found with that id for this page.', 404));
  res.status(200).json(apiResponse('Revision retrieved successfully', true, revision));
});

const getPageRevisions = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page) return next(new ApiError('No page found with that id', 404));
  const revisions = await WebsiteRevision.find({ page: page._id }).select('-snapshot').sort({ publishedAt: -1 }).populate('publishedBy', 'name');
  res.status(200).json(apiResponse('Revisions retrieved successfully', true, revisions));
});

// Restores a revision's snapshot onto the LIVE section docs AND republishes (a new revision
// pointing at the restored state + a real rebuild trigger) - test 13 expects the restored version
// live again, not just back in the editor (plan doc section 3).
const revertPageToRevision = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));
  const revision = await WebsiteRevision.findOne({ _id: req.params.revisionId, page: page._id });
  if (!revision) return next(new ApiError('No revision found with that id for this page.', 404));

  await WebsiteSection.deleteMany({ page: page._id });
  const restoredSections = revision.snapshot.sections || [];
  if (restoredSections.length) {
    await WebsiteSection.insertMany(restoredSections.map(s => ({ page: page._id, type: s.type, sortOrder: s.sortOrder, isVisible: s.isVisible, content: s.content, settings: s.settings ? validateSettings(s.settings) : {}, adminLabel: s.adminLabel || '', createdBy: req.user._id, updatedBy: req.user._id })));
  }
  page.seo = revision.snapshot.seo;
  if (revision.snapshot.titleEn !== undefined) page.titleEn = revision.snapshot.titleEn;
  if (revision.snapshot.titleAr !== undefined) page.titleAr = revision.snapshot.titleAr;
  if (revision.snapshot.layout) page.layout = revision.snapshot.layout;
  if (Array.isArray(revision.snapshot.locales) && revision.snapshot.locales.length) page.locales = revision.snapshot.locales;

  const newRevision = await WebsiteRevision.create({
    page: page._id,
    label: `Restored from ${revision.publishedAt.toISOString().slice(0, 10)}`,
    snapshot: revision.snapshot,
    publishedBy: req.user._id,
  });
  page.status = 'published';
  page.publishedAt = new Date();
  page.publishedBy = req.user._id;
  page.publishedRevision = newRevision._id;
  await page.save();

  await logWebsiteActivity({ actor: req.user, action: 'page.revert', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, after: { restoredFrom: revision._id, newRevision: newRevision._id } });

  const deploy = await triggerPublishDeploy();
  res.status(200).json(apiResponse('Page reverted and republished successfully', true, { page, revision: newRevision, deploy }));
});

const requestPreviewDeploy = asyncHandler(async (req, res) => {
  const deploy = await triggerPreviewDeploy();
  await logWebsiteActivity({ actor: req.user, action: 'deploy.preview', targetType: 'WebsitePage' });
  res.status(200).json(apiResponse('Preview deploy requested', true, { ...deploy, previewUrl: getPreviewUrl() }));
});

// The dashboard's live SEO preview (brief 2.3): the page's saved draft with the editor's UNSAVED
// changes laid over it (`req.body` - nothing is written), resolved by the same seoResolver the
// public feed uses, in the context of what is currently live. The editor sees exactly the
// title/description/canonical/hreflang the website will render, plus what still blocks publishing.
const previewPageSeo = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id).lean();
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));

  const { seo, locales, path, parentSlug, pageType, isHomePage } = req.body || {};
  const sections = await WebsiteSection.find({ page: page._id }).sort({ sortOrder: 1 }).lean();
  const draft = {
    ...page,
    path: path !== undefined ? normalizePath(path) : page.path,
    parentSlug: parentSlug !== undefined ? parentSlug || null : page.parentSlug,
    pageType: pageType !== undefined ? pageType : page.pageType,
    isHomePage: isHomePage !== undefined ? isHomePage : page.isHomePage,
    locales: locales !== undefined ? locales : page.locales,
    seo: { ...(page.seo || {}), ...(seo || {}) },
    sections: sections.filter(s => s.isVisible !== false),
  };
  const [settings, published] = await Promise.all([loadSettings(), loadPublishedPages()]);
  res.status(200).json(apiResponse('SEO preview generated', true, resolveDraft(draft, published, settings)));
});

// SEO health of every page's CURRENT DRAFT, for the Pages list (missing/duplicate titles and
// descriptions, generated defaults, noindex) - "what would be live if everything were published".
const getSeoAudit = asyncHandler(async (req, res) => {
  const [settings, drafts] = await Promise.all([loadSettings(), loadDraftPages()]);
  const site = resolveSite(drafts, settings);
  const byId = new Map(drafts.map(d => [d.slug, d]));
  const data = site.pages.map(p => {
    const d = byId.get(p.slug);
    const warnings = {};
    for (const [locale, s] of Object.entries(p.seo)) warnings[locale] = s.warnings;
    return { pageId: d._id, slug: p.slug, locales: p.locales, warnings, problems: publishProblems(d, d.sections, settings) };
  });
  res.status(200).json(apiResponse('SEO audit generated', true, { origin: site.origin, pages: data }));
});

module.exports = {
  displayStatus,
  reorderPages,
  schedulePage,
  cancelSchedule,
  archivePage,
  restorePage,
  runScheduledPublishes,
  createPagePreview,
  getPageRevision,
  createPage,
  getPages,
  getPage,
  updatePage,
  duplicatePage,
  deletePage,
  publishPage,
  unpublishPage,
  getPageRevisions,
  revertPageToRevision,
  requestPreviewDeploy,
  previewPageSeo,
  getSeoAudit,
};
