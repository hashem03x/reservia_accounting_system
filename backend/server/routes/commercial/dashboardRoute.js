const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const dashboardController = require('../../controller/commercial/dashboardController');

// Mounted at /api/v1/commercial/dashboard.
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.get('/', dashboardController.getDashboard);

module.exports = router;
