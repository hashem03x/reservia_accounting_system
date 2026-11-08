const asyncHandler = require('express-async-handler');
const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const WebsiteRevision = require('../../models/website/websiteRevisionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { triggerPublishDeploy, triggerPreviewDeploy, getPreviewUrl } = require('../../services/website/deployService');

// Website Management - Pages. Mirrors chartOfAccountController.js's CRUD conventions
// (asyncHandler, ApiError/apiResponse, duplicate-key translation, soft-deactivate instead of
// hard delete for anything another record can reference).

const createPage = asyncHandler(async (req, res, next) => {
  try {
    const { slug, path, isHomePage, pageType, parentSlug, sortOrder, seo } = req.body;
    const page = await WebsitePage.create({ slug, path, isHomePage, pageType, parentSlug, sortOrder, seo, createdBy: req.user._id });
    await logWebsiteActivity({ actor: req.user, action: 'page.create', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, after: page.toObject() });
    res.status(201).json(apiResponse('Page created successfully', true, page));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A page with this slug already exists.', 400));
    throw err;
  }
});

const getPages = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const countDocuments = await WebsitePage.countDocuments(filter);
  const features = new ApiFeatures(WebsitePage.find(filter), req.query).paginate(countDocuments).limitFields();
  const pages = await features.mongooseQuery.sort({ sortOrder: 1, createdAt: 1 });
  res.status(200).json({ results: pages.length, paginationResult: features.paginationResult, data: pages });
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
  res.status(200).json(apiResponse('Page retrieved successfully', true, { ...page.toObject(), hasPendingChanges: pending }));
});

const updatePage = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));

  try {
    const before = page.toObject();
    const { path, isHomePage, pageType, parentSlug, sortOrder, seo } = req.body;
    if (path !== undefined) page.path = path;
    if (isHomePage !== undefined) page.isHomePage = isHomePage;
    if (pageType !== undefined) page.pageType = pageType;
    if (parentSlug !== undefined) page.parentSlug = parentSlug;
    if (sortOrder !== undefined) page.sortOrder = sortOrder;
    if (seo !== undefined) page.seo = { ...page.seo.toObject(), ...seo };
    page.updatedBy = req.user._id;
    await page.save();

    await logWebsiteActivity({ actor: req.user, action: 'page.update', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, before, after: page.toObject() });
    res.status(200).json(apiResponse('Page updated successfully', true, page));
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

  try {
    const copy = await WebsitePage.create({
      slug,
      path,
      isHomePage: false,
      pageType: original.pageType,
      parentSlug: original.parentSlug,
      sortOrder: original.sortOrder,
      seo: original.seo,
      createdBy: req.user._id,
    });
    const sections = await WebsiteSection.find({ page: original._id }).sort({ sortOrder: 1 }).lean();
    if (sections.length) {
      await WebsiteSection.insertMany(sections.map(s => ({ page: copy._id, type: s.type, sortOrder: s.sortOrder, isVisible: s.isVisible, content: s.content, createdBy: req.user._id })));
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

  page.isActive = false;
  page.updatedBy = req.user._id;
  await page.save();
  await logWebsiteActivity({ actor: req.user, action: 'page.delete', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug });
  res.status(200).json(apiResponse('Page deleted successfully', true, page));
});

// Publish: snapshots the page's CURRENT draft (sections + seo) into a new WebsiteRevision, points
// publishedRevision at it, and (only if configured - see deployService.js) triggers the real
// production rebuild. The live website is built from this frozen snapshot, never from the live
// (possibly newer, unpublished) section docs directly - see websiteRevisionModel.js.
const publishPage = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));

  if (!page.seo?.titleEn?.trim() || !page.seo?.descriptionEn?.trim()) {
    return next(new ApiError('This page cannot be published without an English SEO title and description.', 400));
  }

  const sections = await WebsiteSection.find({ page: page._id }).sort({ sortOrder: 1 }).lean();
  const revision = await WebsiteRevision.create({
    page: page._id,
    label: req.body?.label || null,
    snapshot: { seo: page.seo.toObject(), sections },
    publishedBy: req.user._id,
  });

  const before = { status: page.status, publishedRevision: page.publishedRevision };
  page.status = 'published';
  page.publishedAt = new Date();
  page.publishedBy = req.user._id;
  page.publishedRevision = revision._id;
  await page.save();

  await logWebsiteActivity({ actor: req.user, action: 'page.publish', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, before, after: { status: page.status, publishedRevision: revision._id } });

  const deploy = await triggerPublishDeploy();
  res.status(200).json(apiResponse('Page published successfully', true, { page, revision, deploy }));
});

const unpublishPage = asyncHandler(async (req, res, next) => {
  const page = await WebsitePage.findById(req.params.id);
  if (!page || !page.isActive) return next(new ApiError('No page found with that id', 404));
  if (page.status !== 'published') return next(new ApiError('This page is not currently published.', 400));

  page.status = 'unpublished';
  await page.save();
  await logWebsiteActivity({ actor: req.user, action: 'page.unpublish', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug });

  const deploy = await triggerPublishDeploy();
  res.status(200).json(apiResponse('Page unpublished successfully', true, { page, deploy }));
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
    await WebsiteSection.insertMany(restoredSections.map(s => ({ page: page._id, type: s.type, sortOrder: s.sortOrder, isVisible: s.isVisible, content: s.content, createdBy: req.user._id, updatedBy: req.user._id })));
  }
  page.seo = revision.snapshot.seo;

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

module.exports = { createPage, getPages, getPage, updatePage, duplicatePage, deletePage, publishPage, unpublishPage, getPageRevisions, revertPageToRevision, requestPreviewDeploy };
