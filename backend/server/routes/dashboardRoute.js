const express = require('express');
const router = express.Router();

const authController = require('../controller/user/authController');
const { getDashboardSummary } = require('../controller/dashboardController');

// Open to any authenticated staff member (mirrors /admin/home itself, which has no ResourceGuard
// on the frontend) - every figure returned is a read-only aggregate, nothing resource-sensitive
// that isn't already visible elsewhere to the same roles.
router.use(authController.protect);

router.get('/summary', getDashboardSummary);

module.exports = router;
