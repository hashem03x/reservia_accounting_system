const asyncHandler = require('express-async-handler');
const WebsiteBlogPost = require('../../models/website/websiteBlogPostModel');
const WebsiteBlogPostRevision = require('../../models/website/websiteBlogPostRevisionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { triggerPublishDeploy } = require('../../services/website/deployService');
const { loadSettings } = require('../../services/website/publishedSite');
const { resolveBlogPost, blogPublishProblems } = require('../../utils/website/blogSeoResolver');
const blogPublishing = require('../../services/website/blogPublishingService');
const { createPreviewToken } = require('../../utils/website/previewToken');
const { sanitizeBlogBody } = require('../../utils/website/htmlSanitizer');

// Website Management - Blog Posts. Mirrors controller/website/pageController.js's CRUD
// conventions exactly (asyncHandler, ApiError/apiResponse, duplicate-key translation, soft-
// deactivate instead of hard delete) - see that file's own header comment for the lineage
// (chartOfAccountController.js's conventions, originally).

/** What the dashboard shows as the post's status: draft / published / scheduled / archived. */
function displayStatus(post) {
  if (post.status === 'archived') return 'archived';
  if (post.scheduledPublishAt) return 'scheduled';
  if (post.status === 'published') return 'published';
  return 'draft';
}

const escapeRegex = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, ch => `\\${ch}`);

/** Sanitizes bodyEn/bodyAr in place on a plain fields object, if present - called on every save. */
function sanitizeBodies(fields) {
  if (fields.bodyEn !== undefined) fields.bodyEn = sanitizeBlogBody(fields.bodyEn);
  if (fields.bodyAr !== undefined) fields.bodyAr = sanitizeBlogBody(fields.bodyAr);
  return fields;
}

const createBlogPost = asyncHandler(async (req, res, next) => {
  try {
    const { slug, titleEn, titleAr, excerptEn, excerptAr, bodyEn, bodyAr, category, tags, author, featuredImage, showRecentSidebar, locales, seo } = sanitizeBodies({ ...req.body });
    const post = await WebsiteBlogPost.create({ slug, titleEn, titleAr, excerptEn, excerptAr, bodyEn, bodyAr, category, tags, author, featuredImage, showRecentSidebar, locales, seo, createdBy: req.user._id });
    await logWebsiteActivity({ actor: req.user, action: 'blogPost.create', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug, after: post.toObject() });
    res.status(201).json(apiResponse('Blog post created successfully', true, post));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A blog post with this slug already exists.', 400));
    throw err;
  }
});

// ?status=draft|published|scheduled|archived  ?q=<title or category>
const getBlogPosts = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const { status, q } = req.query;
  if (status === 'archived') filter.status = 'archived';
  else if (status === 'scheduled') filter.scheduledPublishAt = { $ne: null };
  else if (status === 'published') Object.assign(filter, { status: 'published', scheduledPublishAt: null });
  else if (status === 'draft') Object.assign(filter, { status: { $in: ['never_published', 'unpublished'] }, scheduledPublishAt: null });
  else if (status !== 'all') filter.status = { $ne: 'archived' };
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 80)), 'i');
    filter.$or = [{ slug: rx }, { titleEn: rx }, { titleAr: rx }, { category: rx }];
  }
  ['status', 'q'].forEach(k => delete req.query[k]);
  const countDocuments = await WebsiteBlogPost.countDocuments(filter);
  const features = new ApiFeatures(WebsiteBlogPost.find(filter), req.query).paginate(countDocuments).limitFields();
  const posts = await features.mongooseQuery.sort({ createdAt: -1 }).lean();
  const data = posts.map(post => ({ ...post, displayStatus: displayStatus(post) }));
  res.status(200).json({ results: data.length, paginationResult: features.paginationResult, data });
});

/** GET /blog-posts/categories?q= - up to 20 previously-used category names, for the CMS autocomplete. */
const getBlogCategorySuggestions = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const filter = { isActive: true, category: { $nin: [null, ''] } };
  if (q) filter.category.$regex = new RegExp(escapeRegex(String(q).slice(0, 60)), 'i');
  const categories = await WebsiteBlogPost.find(filter).sort({ createdAt: -1 }).limit(100).distinct('category');
  res.status(200).json(apiResponse('Category suggestions retrieved', true, categories.slice(0, 20)));
});

const getBlogPost = asyncHandler(async (req, res, next) => {
  const post = await WebsiteBlogPost.findById(req.params.id);
  if (!post || !post.isActive) return next(new ApiError('No blog post found with that id', 404));
  res.status(200).json(apiResponse('Blog post retrieved successfully', true, { ...post.toObject(), displayStatus: displayStatus(post) }));
});

const updateBlogPost = asyncHandler(async (req, res, next) => {
  const post = await WebsiteBlogPost.findById(req.params.id);
  if (!post || !post.isActive) return next(new ApiError('No blog post found with that id', 404));

  try {
    const before = post.toObject();
    const { titleEn, titleAr, excerptEn, excerptAr, bodyEn, bodyAr, category, tags, author, featuredImage, showRecentSidebar, locales, seo, slug } = sanitizeBodies({ ...req.body });
    if (slug !== undefined && slug !== post.slug) {
      if (await WebsiteBlogPost.exists({ slug, _id: { $ne: post._id } })) return next(new ApiError('A blog post with this slug already exists.', 400));
      post.slug = slug;
    }
    if (titleEn !== undefined) post.titleEn = titleEn;
    if (titleAr !== undefined) post.titleAr = titleAr;
    if (excerptEn !== undefined) post.excerptEn = excerptEn;
    if (excerptAr !== undefined) post.excerptAr = excerptAr;
    if (bodyEn !== undefined) post.bodyEn = bodyEn;
    if (bodyAr !== undefined) post.bodyAr = bodyAr;
    if (category !== undefined) post.category = category;
    if (tags !== undefined) post.tags = tags;
    if (author !== undefined) post.author = { ...(post.author ? post.author.toObject() : {}), ...author };
    if (featuredImage !== undefined) post.featuredImage = featuredImage;
    if (showRecentSidebar !== undefined) post.showRecentSidebar = showRecentSidebar;
    if (locales !== undefined) post.locales = locales;
    // A partial merge: only the SEO fields the request names change; every other field the editor
    // set earlier is kept exactly as it was (same convention as pageController.js#updatePage).
    if (seo !== undefined) post.seo = { ...post.seo.toObject(), ...seo };
    post.updatedBy = req.user._id;
    await post.save();

    await logWebsiteActivity({ actor: req.user, action: 'blogPost.update', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug, before, after: post.toObject() });
    res.status(200).json(apiResponse('Blog post updated successfully', true, { ...post.toObject(), displayStatus: displayStatus(post) }));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A blog post with this slug already exists.', 400));
    throw err;
  }
});

// Soft-deactivate - a post referenced by a WebsiteBlogPostRevision/the live site must never
// disappear from under published history (mirrors pageController.js#deletePage exactly).
const deleteBlogPost = asyncHandler(async (req, res, next) => {
  const post = await WebsiteBlogPost.findById(req.params.id);
  if (!post) return next(new ApiError('No blog post found with that id', 404));

  const wasLive = post.isActive && post.status === 'published';
  post.isActive = false;
  post.updatedBy = req.user._id;
  await post.save();
  await logWebsiteActivity({ actor: req.user, action: 'blogPost.delete', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug });
  const deploy = wasLive ? await triggerPublishDeploy() : null;
  res.status(200).json(apiResponse('Blog post deleted successfully', true, { ...post.toObject(), deploy }));
});

// Publish / unpublish / schedule / archive - services/website/blogPublishingService.js.
const publishBlogPost = asyncHandler(async (req, res) => {
  const result = await blogPublishing.publishBlogPostNow(req.params.id, { user: req.user, label: req.body?.label });
  res.status(200).json(apiResponse('Blog post published successfully', true, result));
});

const unpublishBlogPost = asyncHandler(async (req, res) => {
  const result = await blogPublishing.unpublishBlogPost(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Blog post unpublished successfully', true, result));
});

const scheduleBlogPost = asyncHandler(async (req, res) => {
  const result = await blogPublishing.scheduleBlogPost(req.params.id, req.body?.publishAt, { user: req.user, label: req.body?.label });
  res.status(200).json(apiResponse('Publish scheduled - the current draft goes live at the chosen time.', true, result));
});

const cancelBlogPostSchedule = asyncHandler(async (req, res) => {
  const post = await blogPublishing.cancelBlogPostSchedule(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Scheduled publish cancelled', true, post));
});

const archiveBlogPost = asyncHandler(async (req, res) => {
  const result = await blogPublishing.archiveBlogPost(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Blog post archived - it is no longer on the website, its history is kept.', true, result));
});

const restoreBlogPost = asyncHandler(async (req, res) => {
  const result = await blogPublishing.restoreBlogPostFromArchive(req.params.id, { user: req.user });
  res.status(200).json(apiResponse('Blog post restored as a draft', true, result));
});

/** POST /blog-posts/:id/preview-token - a signed link that renders THIS post's draft on the real website. */
const createBlogPostPreview = asyncHandler(async (req, res, next) => {
  const post = await WebsiteBlogPost.findById(req.params.id).lean();
  if (!post || !post.isActive) return next(new ApiError('No blog post found with that id', 404));
  const { token, expiresAt } = createPreviewToken(post._id, { userId: req.user._id, kind: 'blogPost' });
  const settings = await loadSettings();
  const origin = (process.env.WEBSITE_PUBLIC_URL || settings.publicSiteUrl || '').replace(/\/+$/, '');
  const lang = req.body?.lang === 'en' ? 'en' : req.body?.lang === 'ar' ? 'ar' : (post.locales || ['ar'])[0];
  const previewUrl = origin ? `${origin}/${lang}/__preview?token=${encodeURIComponent(token)}` : null;
  await logWebsiteActivity({ actor: req.user, action: 'preview.create', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug });
  res.status(200).json(apiResponse(previewUrl ? 'Preview link created' : 'Preview token created - set the public website URL in Website Settings to open it.', true, { token, expiresAt, previewUrl }));
});

const getBlogPostRevision = asyncHandler(async (req, res, next) => {
  const revision = await WebsiteBlogPostRevision.findOne({ _id: req.params.revisionId, post: req.params.id }).populate('publishedBy', 'name');
  if (!revision) return next(new ApiError('No revision found with that id for this blog post.', 404));
  res.status(200).json(apiResponse('Revision retrieved successfully', true, revision));
});

const getBlogPostRevisions = asyncHandler(async (req, res, next) => {
  const post = await WebsiteBlogPost.findById(req.params.id);
  if (!post) return next(new ApiError('No blog post found with that id', 404));
  const revisions = await WebsiteBlogPostRevision.find({ post: post._id }).select('-snapshot').sort({ publishedAt: -1 }).populate('publishedBy', 'name');
  res.status(200).json(apiResponse('Revisions retrieved successfully', true, revisions));
});

// Restores a revision's content onto the draft AND republishes (a new revision pointing at the
// restored state + a real rebuild trigger) - mirrors pageController.js#revertPageToRevision.
const revertBlogPostToRevision = asyncHandler(async (req, res, next) => {
  const post = await WebsiteBlogPost.findById(req.params.id);
  if (!post || !post.isActive) return next(new ApiError('No blog post found with that id', 404));
  const revision = await WebsiteBlogPostRevision.findOne({ _id: req.params.revisionId, post: post._id });
  if (!revision) return next(new ApiError('No revision found with that id for this blog post.', 404));

  const snap = revision.snapshot || {};
  post.seo = snap.seo || {};
  if (snap.titleEn !== undefined) post.titleEn = snap.titleEn;
  if (snap.titleAr !== undefined) post.titleAr = snap.titleAr;
  if (snap.excerptEn !== undefined) post.excerptEn = snap.excerptEn;
  if (snap.excerptAr !== undefined) post.excerptAr = snap.excerptAr;
  if (snap.bodyEn !== undefined) post.bodyEn = snap.bodyEn;
  if (snap.bodyAr !== undefined) post.bodyAr = snap.bodyAr;
  if (snap.category !== undefined) post.category = snap.category;
  if (Array.isArray(snap.tags)) post.tags = snap.tags;
  if (snap.author !== undefined) post.author = snap.author;
  if (snap.featuredImage !== undefined) post.featuredImage = snap.featuredImage;
  if (snap.showRecentSidebar !== undefined) post.showRecentSidebar = snap.showRecentSidebar;
  if (Array.isArray(snap.locales) && snap.locales.length) post.locales = snap.locales;

  const newRevision = await WebsiteBlogPostRevision.create({
    post: post._id,
    label: `Restored from ${revision.publishedAt.toISOString().slice(0, 10)}`,
    snapshot: snap,
    publishedBy: req.user._id,
  });
  post.status = 'published';
  post.publishedAt = new Date();
  post.publishedBy = req.user._id;
  post.publishedRevision = newRevision._id;
  await post.save();

  await logWebsiteActivity({ actor: req.user, action: 'blogPost.revert', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug, after: { restoredFrom: revision._id, newRevision: newRevision._id } });

  const deploy = await triggerPublishDeploy();
  res.status(200).json(apiResponse('Blog post reverted and republished successfully', true, { post, revision: newRevision, deploy }));
});

// The dashboard's live SEO preview: the post's saved draft with the editor's UNSAVED changes laid
// over it (req.body - nothing is written), resolved by the same blogSeoResolver the public feed
// uses. Mirrors pageController.js#previewPageSeo.
const previewBlogPostSeo = asyncHandler(async (req, res, next) => {
  const post = await WebsiteBlogPost.findById(req.params.id).lean();
  if (!post || !post.isActive) return next(new ApiError('No blog post found with that id', 404));

  const { seo, locales, titleEn, titleAr, excerptEn, excerptAr, bodyEn, bodyAr, featuredImage } = req.body || {};
  const draft = {
    ...post,
    titleEn: titleEn !== undefined ? titleEn : post.titleEn,
    titleAr: titleAr !== undefined ? titleAr : post.titleAr,
    excerptEn: excerptEn !== undefined ? excerptEn : post.excerptEn,
    excerptAr: excerptAr !== undefined ? excerptAr : post.excerptAr,
    bodyEn: bodyEn !== undefined ? bodyEn : post.bodyEn,
    bodyAr: bodyAr !== undefined ? bodyAr : post.bodyAr,
    featuredImage: featuredImage !== undefined ? featuredImage : post.featuredImage,
    locales: locales !== undefined ? locales : post.locales,
    seo: { ...(post.seo || {}), ...(seo || {}) },
    publishedAt: post.publishedAt || new Date(),
  };
  const settings = await loadSettings();
  const resolved = resolveBlogPost(draft, settings.publicSiteUrl, settings);
  res.status(200).json(apiResponse('SEO preview generated', true, { ...resolved, problems: blogPublishProblems(draft, settings) }));
});

module.exports = {
  displayStatus,
  createBlogPost,
  getBlogPosts,
  getBlogCategorySuggestions,
  getBlogPost,
  updateBlogPost,
  deleteBlogPost,
  publishBlogPost,
  unpublishBlogPost,
  scheduleBlogPost,
  cancelBlogPostSchedule,
  archiveBlogPost,
  restoreBlogPost,
  createBlogPostPreview,
  getBlogPostRevision,
  getBlogPostRevisions,
  revertBlogPostToRevision,
  previewBlogPostSeo,
};
