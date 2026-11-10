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
  revertPageToRevision,
  requestPreviewDeploy,
  previewPageSeo,
  getSeoAudit,
} = require('../../controller/website/pageController');
const { createPageValidators, updatePageValidators, duplicatePageValidators, publishPageValidators, previewPageSeoValidators } = require('../../utils/validators/website/pageValidators');
const sectionRoute = require('./sectionRoute');

router.use(authController.protect, requireWebsiteAccess);

router
  .route('/')
  .get(requireWebsiteCapability('view'), getPages)
  .post(requireWebsiteCapability('edit'), createPageValidators, createPage);

router.post('/preview-deploy', requireWebsiteCapability('edit'), requestPreviewDeploy);
router.get('/seo-audit', requireWebsiteCapability('view'), getSeoAudit);

router
  .route('/:id')
  .get(requireWebsiteCapability('view'), getPage)
  .patch(requireWebsiteCapability('edit'), updatePageValidators, updatePage)
  .delete(requireWebsiteCapability('edit'), deletePage);

// Read-only (nothing is saved) - a POST only because it carries the editor's unsaved fields.
router.post('/:id/seo-preview', requireWebsiteCapability('view'), previewPageSeoValidators, previewPageSeo);
router.post('/:id/duplicate', requireWebsiteCapability('edit'), duplicatePageValidators, duplicatePage);
router.post('/:id/publish', requireWebsiteCapability('publish'), publishPageValidators, publishPage);
router.post('/:id/unpublish', requireWebsiteCapability('publish'), unpublishPage);
router.get('/:id/revisions', requireWebsiteCapability('view'), getPageRevisions);
router.post('/:id/revisions/:revisionId/revert', requireWebsiteCapability('publish'), revertPageToRevision);

// Nested: /pages/:pageId/sections/...
router.use('/:pageId/sections', sectionRoute);

module.exports = router;
