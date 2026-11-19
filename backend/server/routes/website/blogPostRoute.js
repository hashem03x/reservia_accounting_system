const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { requireWebsiteAccess, requireWebsiteCapability } = require('../../middleware/websiteAccess');
const {
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
  getBlogPostRevisions,
  getBlogPostRevision,
  revertBlogPostToRevision,
  previewBlogPostSeo,
} = require('../../controller/website/blogPostController');
const { createBlogPostValidators, updateBlogPostValidators, publishBlogPostValidators, previewBlogPostSeoValidators } = require('../../utils/validators/website/blogPostValidators');

// Website Management - Blog Posts. Mirrors routes/website/pageRoute.js's structure exactly.
// Scheduled publishing is applied by the EXISTING pages cron tick (GET /website/pages/cron/
// scheduled - see controller/website/pageController.js#runScheduledPublishes), not a second route
// here - there is no second external scheduler configured for this repo to point at one.

router.use(authController.protect, requireWebsiteAccess);

router
  .route('/')
  .get(requireWebsiteCapability('view'), getBlogPosts)
  .post(requireWebsiteCapability('edit'), createBlogPostValidators, createBlogPost);

// Static paths first - they must not be captured by '/:id'.
router.get('/categories', requireWebsiteCapability('view'), getBlogCategorySuggestions);

router
  .route('/:id')
  .get(requireWebsiteCapability('view'), getBlogPost)
  .patch(requireWebsiteCapability('edit'), updateBlogPostValidators, updateBlogPost)
  .delete(requireWebsiteCapability('edit'), deleteBlogPost);

// Read-only (nothing is saved) - a POST only because it carries the editor's unsaved fields.
router.post('/:id/seo-preview', requireWebsiteCapability('view'), previewBlogPostSeoValidators, previewBlogPostSeo);
// Signed, short-lived token that lets the real website render this post's draft.
router.post('/:id/preview-token', requireWebsiteCapability('view'), createBlogPostPreview);
router.post('/:id/publish', requireWebsiteCapability('publish'), publishBlogPostValidators, publishBlogPost);
router.post('/:id/unpublish', requireWebsiteCapability('publish'), unpublishBlogPost);
router
  .route('/:id/schedule')
  .post(requireWebsiteCapability('publish'), scheduleBlogPost)
  .delete(requireWebsiteCapability('publish'), cancelBlogPostSchedule);
router.post('/:id/archive', requireWebsiteCapability('publish'), archiveBlogPost);
router.post('/:id/restore', requireWebsiteCapability('publish'), restoreBlogPost);
router.get('/:id/revisions', requireWebsiteCapability('view'), getBlogPostRevisions);
router.get('/:id/revisions/:revisionId', requireWebsiteCapability('view'), getBlogPostRevision);
router.post('/:id/revisions/:revisionId/revert', requireWebsiteCapability('publish'), revertBlogPostToRevision);

module.exports = router;
