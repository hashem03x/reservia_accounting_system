const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { requireWebsiteAccess, requireWebsiteCapability } = require('../../middleware/websiteAccess');
const {
  createPage,
  getPages,
  getPage,
  updatePage,
  duplicatePage,
  deletePage,
  publishPage,
  unpublishPage,
  getPageRevisions,
  getPageRevision,
  revertPageToRevision,
  requestPreviewDeploy,
  previewPageSeo,
  getSeoAudit,
  reorderPages,
  schedulePage,
  cancelSchedule,
  archivePage,
  restorePage,
  runScheduledPublishes,
  createPagePreview,
} = require('../../controller/website/pageController');
const { createPageValidators, updatePageValidators, duplicatePageValidators, publishPageValidators, previewPageSeoValidators } = require('../../utils/validators/website/pageValidators');
const sectionRoute = require('./sectionRoute');

// Scheduled publishing tick (Vercel Cron / any scheduler). NOT a user route: authorised by the
// server-held CRON_SECRET bearer token inside the controller, so it sits before `protect`.
router.get('/cron/scheduled', runScheduledPublishes);

router.use(authController.protect, requireWebsiteAccess);

router
  .route('/')
  .get(requireWebsiteCapability('view'), getPages)
  .post(requireWebsiteCapability('edit'), createPageValidators, createPage);

// Static paths first - they must not be captured by '/:id'.
router.patch('/reorder', requireWebsiteCapability('edit'), reorderPages);
router.post('/preview-deploy', requireWebsiteCapability('edit'), requestPreviewDeploy);
router.get('/seo-audit', requireWebsiteCapability('view'), getSeoAudit);

router
  .route('/:id')
  .get(requireWebsiteCapability('view'), getPage)
  .patch(requireWebsiteCapability('edit'), updatePageValidators, updatePage)
  .delete(requireWebsiteCapability('edit'), deletePage);

// Read-only (nothing is saved) - a POST only because it carries the editor's unsaved fields.
router.post('/:id/seo-preview', requireWebsiteCapability('view'), previewPageSeoValidators, previewPageSeo);
// Signed, short-lived token that lets the real website render this page's draft.
router.post('/:id/preview-token', requireWebsiteCapability('view'), createPagePreview);
router.post('/:id/duplicate', requireWebsiteCapability('edit'), duplicatePageValidators, duplicatePage);
router.post('/:id/publish', requireWebsiteCapability('publish'), publishPageValidators, publishPage);
router.post('/:id/unpublish', requireWebsiteCapability('publish'), unpublishPage);
router
  .route('/:id/schedule')
  .post(requireWebsiteCapability('publish'), schedulePage)
  .delete(requireWebsiteCapability('publish'), cancelSchedule);
router.post('/:id/archive', requireWebsiteCapability('publish'), archivePage);
router.post('/:id/restore', requireWebsiteCapability('publish'), restorePage);
router.get('/:id/revisions', requireWebsiteCapability('view'), getPageRevisions);
router.get('/:id/revisions/:revisionId', requireWebsiteCapability('view'), getPageRevision);
router.post('/:id/revisions/:revisionId/revert', requireWebsiteCapability('publish'), revertPageToRevision);

// Nested: /pages/:pageId/sections/...
router.use('/:pageId/sections', sectionRoute);

module.exports = router;
