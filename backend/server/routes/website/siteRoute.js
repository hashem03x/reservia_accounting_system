const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { requireWebsiteAccess, requireWebsiteCapability } = require('../../middleware/websiteAccess');
const { getSectionTypes } = require('../../controller/website/sectionController');
const { getOverview, getActivity, deployLiveSite } = require('../../controller/website/overviewController');
const { getNavigation, updateNavigation } = require('../../controller/website/navigationController');
const { getIntegrations, updateIntegrations } = require('../../controller/website/integrationController');
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

router.get('/navigation', gate('view'), getNavigation);
router.put('/navigation', gate('navigation.manage'), updateNavigation);

// Tracking ids and verification codes: administrators only, reading included.
router.get('/integrations', gate('integrations.manage'), getIntegrations);
router.put('/integrations', gate('integrations.manage'), updateIntegrations);

// Executable code: administrators only, every operation.
router.get('/custom-code', gate('code.manage'), listCustomCode);
router.post('/custom-code', gate('code.manage'), createCustomCode);
router.post('/custom-code/validate', gate('code.manage'), validateSnippet);
router.patch('/custom-code/:id', gate('code.manage'), updateCustomCode);
router.delete('/custom-code/:id', gate('code.manage'), deleteCustomCode);

module.exports = router;
