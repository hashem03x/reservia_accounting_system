const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCrmAccess } = require('../../middleware/crmAccess');
const reportController = require('../../controller/crm/reportController');

const router = express.Router();

// Every CRM role may read these - the controller itself scopes a non-manager caller to their own
// leads (see controller/crm/reportController.js#resolveOwnerId); there is no separate write
// action here to gate.
router.use(authController.protect, requireCrmAccess);

router.get('/dashboard', reportController.getDashboard);
router.get('/performance', reportController.getPerformance);

module.exports = router;
