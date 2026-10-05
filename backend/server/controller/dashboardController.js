const asyncHandler = require('express-async-handler');
const apiResponse = require('../utils/apiResponse');
const { getDashboardSummaryData } = require('../services/dashboard/dashboardService');

// GET /dashboard/summary - a single, read-only aggregated endpoint for the Admin Home dashboard
// (docs section "Admin Home / Dashboard"). See dashboardService.js#getDashboardSummaryData for the
// actual aggregation logic/comments.
exports.getDashboardSummary = asyncHandler(async (req, res) => {
  const summary = await getDashboardSummaryData();
  res.status(200).json(apiResponse('Dashboard summary retrieved successfully', true, summary));
});
