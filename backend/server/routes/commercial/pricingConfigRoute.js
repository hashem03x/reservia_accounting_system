const express = require('express');
const authController = require('../../controller/user/authController');
const controller = require('../../controller/commercial/pricingConfigController');

// Mounted at /api/v1/commercial/pricing-config (QA finding B3).
const router = express.Router();

router.use(authController.protect);

router.get('/', controller.requireReadAccess, controller.getConfig);
router.put('/', controller.requireManageAccess, controller.updateConfig);
router.get('/history', controller.requireReadAccess, controller.getHistory);

module.exports = router;
