const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { requireWebsiteAccess, requireWebsiteCapability } = require('../../middleware/websiteAccess');
const { getSettings, updateSettings } = require('../../controller/website/settingsController');
const { updateSettingsValidators } = require('../../utils/validators/website/settingsValidators');

// Website Management - site-wide settings: anyone with Website access may read them (the SEO
// preview depends on them); only `settings.manage` (the website admin role) may change them.
router.use(authController.protect, requireWebsiteAccess);

router
  .route('/')
  .get(requireWebsiteCapability('view'), getSettings)
  .put(requireWebsiteCapability('settings.manage'), updateSettingsValidators, updateSettings);

module.exports = router;
