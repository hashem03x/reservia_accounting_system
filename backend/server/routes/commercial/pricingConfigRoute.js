const express = require('express');
const authController = require('../../controller/user/authController');
const controller = require('../../controller/commercial/pricingConfigController');

// Mounted at /api/v1/commercial/pricing-config (QA finding B3).
const router = express.Router();

router.use(authController.protect);

router.get('/', controller.requireReadAccess, controller.getConfig);
router.put('/', controller.requireManageAccess, controller.updateConfig);
router.get('/history', controller.requireReadAccess, controller.getHistory);
router.get('/cogs-accounts', controller.requireManageAccess, controller.getCogsAccounts);
// Rates Matrix: read by any Deal Engine member; a change is a new version (Pricing Config managers).
router.get('/rates-matrix', controller.requireReadAccess, controller.getRatesMatrix);
router.post('/rates-matrix', controller.requireManageAccess, controller.saveRatesMatrix);
router.post('/rates-matrix/reference', controller.requireManageAccess, controller.loadReferenceRatesMatrix);

module.exports = router;
