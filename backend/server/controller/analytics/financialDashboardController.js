const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const { financialDashboard } = require('../../services/analytics/financialDashboardService');

// GET /analytics/financial-dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD[&compareFrom&compareTo]
// Read-only: computing the dashboard never changes any record.
exports.getFinancialDashboard = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Financial dashboard generated successfully', true, await financialDashboard(req.query)));
});
