const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { requireWebsiteAccess, requireWebsiteCapability } = require('../../middleware/websiteAccess');
const { getSectionTypes } = require('../../controller/website/sectionController');
const { getOverview, getActivity, deployLiveSite, getLiveStatus } = require('../../controller/website/overviewController');
const { getNavigation, updateNavigation } = require('../../controller/website/navigationController');
const { getIntegrations, updateIntegrations } = require('../../controller/website/integrationController');
const visual = require('../../controller/website/visualController');
const { listCustomCode, validateSnippet, createCustomCode, updateCustomCode, deleteCustomCode } = require('../../controller/website/customCodeController');

// Website Management - site-wide modules. Mounted at /api/v1/website, so authentication is applied
// per route here (never router.use) - a router-level gate would also catch /website/public/*.
// Every capability is checked server-side (middleware/websiteAccess.js); the dashboard hiding a
// screen is a convenience, never the control.
const gate = (...caps) => [authController.protect, requireWebsiteAccess, requireWebsiteCapability(...caps)];

router.get('/overview', gate('view'), getOverview);
// The section registry (types, fields, settings schema) - the page builder's single source of truth.
router.get('/section-types', gate('view'), getSectionTypes);
router.get('/activity', gate('view'), getActivity);
router.post('/deploy', gate('publish'), deployLiveSite);
// Whether the live website was rebuilt from what is published now (its /cms-build.json stamp).
router.get('/live-status', gate('view'), getLiveStatus);

router.get('/navigation', gate('view'), getNavigation);
router.put('/navigation', gate('navigation.manage'), updateNavigation);

// Tracking ids and verification codes: administrators only, reading included.
router.get('/integrations', gate('integrations.manage'), getIntegrations);
router.put('/integrations', gate('integrations.manage'), updateIntegrations);

// Visual Editor: open read-only (view), edit content/element styles (edit - global design and
// custom CSS/HTML additionally need design.manage / code.manage, checked in the controller),
// publish and roll back the live design (publish).
router.get('/visual/draft', gate('view'), visual.getDraft);
router.put('/visual/draft', gate('edit'), visual.saveDraft);
router.post('/visual/preview-token', gate('view'), visual.createToken);
router.get('/visual/revisions', gate('view'), visual.listRevisions);
router.get('/visual/revisions/:id', gate('view'), visual.getRevision);
router.post('/visual/revisions/:id/restore', gate('edit'), visual.restoreRevision);
router.post('/visual/revisions/:id/rollback', gate('publish'), visual.rollback);
router.post('/visual/publish', gate('publish'), visual.publishDraft);

// Source-code workspace (Git-backed, separate work branch): administrators only; going live
// (merging into production) additionally needs publish.
const code = require('../../controller/website/codeController');
router.get('/code/status', gate('code.manage'), code.status);
router.get('/code/files', gate('code.manage'), code.files);
router.get('/code/file', gate('code.manage'), code.readFile);
router.get('/code/history', gate('code.manage'), code.history);
router.put('/code/file', gate('code.manage'), code.saveFile);
router.post('/code/revert', gate('code.manage'), code.revertFile);
router.post('/code/discard', gate('code.manage'), code.discard);
router.post('/code/pull-request', gate('code.manage'), code.pullRequest);
router.post('/code/deploy', gate('code.manage', 'publish'), code.deploy);

// Executable code: administrators only, every operation.
router.get('/custom-code', gate('code.manage'), listCustomCode);
router.post('/custom-code', gate('code.manage'), createCustomCode);
router.post('/custom-code/validate', gate('code.manage'), validateSnippet);
router.patch('/custom-code/:id', gate('code.manage'), updateCustomCode);
router.delete('/custom-code/:id', gate('code.manage'), deleteCustomCode);

module.exports = router;
